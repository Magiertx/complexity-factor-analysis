import networkx # for storing directly follows graph internally
import matplotlib.pyplot as plt # for displaying directly follows graphs and storing them on disk
import math # infinite values for maximum and minimum search
from tabulate import tabulate # for printing the connection values for cross-connectivity, if enabled

from ..logcomplexity import Complexity as LogComplexity # (internal) for getting the set of events in an event log
from .. import Constants # (internal) for picking attributes in event logs


class DirectlyFollowsGraph:
    def __init__(self, pm4py_log):
        # we use a networkx directed graph internally to unlock a wide variety of useful graph-algorithms
        self.graph = networkx.DiGraph()
        # create two special nodes marking the start and the end of the traces
        self.start = "▷"
        self.end = "□"
        self.graph.add_node(self.start)
        self.graph.add_node(self.end)
        # calculate the set of events
        events = set()
        events_per_case = LogComplexity.aux_event_classes(pm4py_log)
        for case in events_per_case.keys():
            events = events.union(events_per_case[case])
        # calculate the edge weights, i.e., how often events follow each other in the log
        edge_weights = {}
        for trace in pm4py_log:
            previous_event = self.start
            for i in range(len(trace) + 1):
                if i < len(trace):
                    current_event = trace[i][Constants.activity_specifier]
                else:
                    current_event = self.end
                if previous_event not in edge_weights.keys():
                    edge_weights[previous_event] = {}
                if current_event not in edge_weights[previous_event].keys():
                    edge_weights[previous_event][current_event] = 0
                edge_weights[previous_event][current_event] += 1
                previous_event = current_event
        # create a node for each event
        for event in events:
            self.graph.add_node(event)
        # add edges between nodes if the respective events are direct neighbors in some trace
        for trace in pm4py_log:
            # add an edge from the start node to the start event of this trace
            self.graph.add_edge(self.start, trace[0][Constants.activity_specifier], weight=edge_weights[self.start][trace[0][Constants.activity_specifier]])
            for i in range(len(trace)-1):
                current_event = trace[i][Constants.activity_specifier]
                next_event = trace[i+1][Constants.activity_specifier]
                self.graph.add_edge(current_event, next_event, weight=edge_weights[current_event][next_event])
            # add an edge from the end event of this trace to the end node
            self.graph.add_edge(trace[-1][Constants.activity_specifier], self.end, weight=edge_weights[trace[-1][Constants.activity_specifier]][self.end])

    def is_connector_node(self, node):
        return self.graph.in_degree(node) > 1 or self.graph.out_degree(node) > 1

    def visualize(self, filename="DFG", show_picture=False):
        plt.clf()
        positions = networkx.bfs_layout(self.graph, self.start)
        networkx.draw_networkx_nodes(self.graph, positions, node_size=500)
        networkx.draw_networkx_edges(self.graph, positions, width=3)
        networkx.draw_networkx_labels(self.graph, positions, font_size=20)
        edge_labels = networkx.get_edge_attributes(self.graph, 'weight')
        networkx.draw_networkx_edge_labels(self.graph, positions, edge_labels)
        axis = plt.gca()
        axis.margins(0.08)
        plt.axis("off")
        plt.tight_layout()
        plt.savefig(filename)
        if show_picture:
            plt.show()

    def size(self):
        return len(self.graph.nodes)

    def mismatch(self):
        xor_mismatch = 0
        for node, out_degree in self.graph.out_degree:
            if out_degree > 1:
                xor_mismatch += out_degree
        for node, in_degree in self.graph.in_degree:
            if in_degree > 1:
                xor_mismatch -= in_degree
        return abs(xor_mismatch)

    def cross_connectivity(self, detailed=False):
        # calculate the node weights in the directly follows graph
        node_weights = {}
        for node in self.graph.nodes:
            # initially set all node weights to 1
            node_weights[node] = 1
            # check if the node n is a xor-split. If so, its weight becomes 1 / deg(n)
            if self.graph.out_degree(node) > 1:
                node_weights[node] = 1 / self.graph.degree(node)
        # calculate the weights of edges in the graph
        edge_weights = {}
        for edge in self.graph.edges:
            edge_weights[edge] = node_weights[edge[0]] * node_weights[edge[1]]
        # define a method for calculating path weights
        def path_weight(simple_path):
            weight = 1
            for i in range(len(simple_path)-1):
                current_edge = (simple_path[i], simple_path[i+1])
                weight *= edge_weights[current_edge]
            return weight
        # define a method for calculating paths starting and ending at the same node
        def get_all_cyclic_paths(start):
            # calculate all simple paths from start to any other node
            all_simple_paths_to_other_nodes = []
            for end in self.graph.nodes:
                all_simple_paths_to_other_nodes += list(networkx.all_simple_paths(self.graph, start, end))
            # find single loop iterations based on the simple paths
            single_loop_iterations = []
            for path in all_simple_paths_to_other_nodes:
                first_node = path[0]
                last_node = path[-1]
                if self.graph.has_edge(last_node, first_node):
                    single_loop_iterations += [path + [first_node]]
            return single_loop_iterations
        # define a method for calculating all paths
        def get_all_paths(start, end):
            # calculate all simple paths from start to end, as Dijkstra and Bellman-Ford are not applicable here
            all_simple_paths = list(networkx.all_simple_paths(self.graph, start, end))
            # remove path that consist of only a single node
            all_simple_paths = [path for path in all_simple_paths if len(path) > 1]
            if start == end:
                all_simple_paths += get_all_cyclic_paths(start)
            return all_simple_paths
        # sum the maximum weights of each path
        sum_of_path_weights = 0
        values = [["V(u,v)"] + [str(u) for u in self.graph.nodes]]
        for u in self.graph.nodes:
            u_val = [str(u)]
            for v in self.graph.nodes:
                if u != v:
                    # calculate all simple paths from u to v, as Dijkstra and Bellman-Ford are not applicable here
                    all_paths = get_all_paths(u, v)
                    # find the longest path of the ones found
                    if len(all_paths) > 0:
                        highest_path_weight = max([path_weight(path) for path in all_paths])
                        u_val += [str(round(highest_path_weight, 5))]
                        sum_of_path_weights += highest_path_weight
                    else:
                        u_val += ["0"]
                else:
                    u_val += ["0"]
            values += [u_val]
        if detailed:
            print(tabulate(values, headers='firstrow', tablefmt='fancy_grid'))
        maximum_sum_of_path_weights = len(self.graph.nodes) * (len(self.graph.nodes) - 1)
        cross_connectivity = 1 - (sum_of_path_weights / maximum_sum_of_path_weights)
        return cross_connectivity

    def control_flow_complexity(self):
        complexity = 0
        for node, out_degree in self.graph.out_degree:
            if out_degree > 1:
                complexity += out_degree
        return complexity

    def separability(self):
        undirected_graph = self.graph.to_undirected()
        number_of_cut_vertices = len(list(networkx.articulation_points(undirected_graph)))
        return 1 - (number_of_cut_vertices / len(self.graph.nodes) - 2)

    def average_connector_degree(self):
        sum_of_degrees = 0
        number_of_connectors = 0
        for node in self.graph.nodes:
            if self.is_connector_node(node):
                sum_of_degrees += self.graph.degree(node)
                number_of_connectors += 1
        if number_of_connectors == 0:
            return None
        return sum_of_degrees / number_of_connectors

    def maximum_connector_degree(self):
        maximum_degree = 0
        for node in self.graph.nodes:
            if self.is_connector_node(node):
                degree = self.graph.degree(node)
                if degree > maximum_degree:
                    maximum_degree = degree
        return maximum_degree

    def sequentiality(self):
        sequential_arcs = 0
        for u, v in self.graph.edges:
            if not self.is_connector_node(u) and not self.is_connector_node(v):
                sequential_arcs += 1
        return 1 - sequential_arcs / len(self.graph.edges)

    def depth(self):
        # initialize the in_depth and the out_depth of each node with 0
        in_depth = {}
        out_depth = {}
        for node in self.graph.nodes:
            in_depth[node] = 0
            out_depth[node] = 0
        # define a sub-procedure to calculate the depth of each node
        def fill_depth_of_nodes(graph, start, node_dict):
            bfs_tree = networkx.bfs_tree(graph, start)
            queue = [start]
            # go through all nodes in breadth first order
            while len(queue) > 0:
                current_node = queue.pop(0)
                # add all neighbors of the current node to the queue
                queue += [neighbor for neighbor in bfs_tree[current_node]]
                # get the parent node, which is either unique or non-existent
                parents = [edge[0] for edge in bfs_tree.in_edges(current_node)]
                # the root node keeps depth 0
                if len(parents) != 0:
                    parent = parents[0]
                    # increase depth if the parent is a split and the current node is not a join
                    if graph.out_degree(parent) > 1 >= graph.in_degree(current_node):
                        node_dict[current_node] = max(node_dict[current_node], node_dict[parent] + 1)
                    # decrease depth if the parent is a join and the current node is not a split
                    elif graph.in_degree(current_node) > 1 >= graph.out_degree(parent):
                        node_dict[current_node] = max(node_dict[current_node], node_dict[parent] - 1)
                    # keep the depth from the parent in all other cases
                    else:
                        node_dict[current_node] = max(node_dict[current_node], node_dict[parent])
        fill_depth_of_nodes(self.graph, self.start, in_depth)
        fill_depth_of_nodes(self.graph.reverse(), self.end, out_depth)
        # calculate the depth of each node
        maximum_depth = -math.inf
        for node in self.graph.nodes:
            depth = min(in_depth[node], out_depth[node])
            if depth > maximum_depth:
                maximum_depth = depth
        return maximum_depth

    def diameter(self):
        all_simple_paths = list(networkx.all_simple_paths(self.graph, self.start, self.end))
        if len(all_simple_paths) == 0:
            return math.inf
        return len(max(all_simple_paths, key=lambda path: len(path)))

    def cyclicity(self):
        simple_cycles = networkx.simple_cycles(self.graph)
        nodes_on_cycles = set()
        for cycle in simple_cycles:
            for node in cycle:
                nodes_on_cycles.add(node)
        return len(nodes_on_cycles) / (len(self.graph.nodes) - 2)

    def coefficient_of_network_connectivity(self):
        return len(self.graph.edges) / len(self.graph.nodes)

    def density(self):
        return len(self.graph.edges) / ((len(self.graph.nodes) - 1)**2)
