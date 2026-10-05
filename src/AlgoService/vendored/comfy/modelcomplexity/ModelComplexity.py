import math # for logarithm and infinity value
import networkx # for easy calculation of graph properties
from tabulate import tabulate # for printing the connection values for cross-connectivity, if enabled

from pm4py.objects.petri_net.obj import PetriNet, Marking # for maintaining Petri nets

def transform_to_networkx(model: PetriNet, undirected=False):
    """
    Returns a networkx graph representing this Petri net.
    All places and transitions become nodes, and the arcs
    connecting them remain the same as in the model.
    :param model: A Petri net in pm4py-format
    :param undirected: A boolean value indicating whether the graph should be undirected
    :return: The Petri net as a networkx Digraph
    """
    # Create a networkx graph that represents the Petri net
    model_graph = networkx.DiGraph()
    if undirected:
        model_graph = networkx.Graph()
    # add all places as nodes
    for place in model.places:
        model_graph.add_node(place)
    # add all transitions as nodes
    for transition in model.transitions:
        model_graph.add_node(transition)
        # for each transition, add all incoming and outgoing arcs to the graph
        for in_arc in transition.in_arcs:
            model_graph.add_edge(in_arc.source, transition)
        for out_arc in transition.out_arcs:
            model_graph.add_edge(transition, out_arc.target)
    return model_graph

def measure_size(model: PetriNet):
    """
    Returns the size of the model, i.e., the number of places and transitions.
    :param model: A Petri net in pm4py-format
    :return: The amount of places plus the amount of transitions in the Petri net
    """
    return len(model.places) + len(model.transitions)

def measure_connector_mismatch(model: PetriNet):
    """
    Returns the mismatch of parallel and exclusive choice nodes in the net.
    This is done by taking the difference of arcs starting a parallel execution
    and the arcs ending a parallel execution, and adding this value to the
    difference of arcs starting a choice and the arcs ending a choice.
    :param model: A Petri net in pm4py-format
    :return: The connector mismatch value of the Petri net
    """
    def mismatch_value(node_list):
        mismatch = 0
        for node in node_list:
            if len(node.out_arcs) > 1:
                mismatch += len(node.out_arcs)
            if len(node.in_arcs) > 1:
                mismatch -= len(node.in_arcs)
        return abs(mismatch)
    and_mismatch = mismatch_value(model.places)
    xor_mismatch = mismatch_value(model.transitions)
    return and_mismatch + xor_mismatch

def measure_connector_heterogeneity(model: PetriNet):
    """
    Returns the connector heterogeneity measure for the input Petri net.
    The connector heterogeneity of a net is the entropy of its connector
    types. If the model contains only one type of connector, its heterogeneity
    is 0. If the model contains equally many connectors of each type (and / xor),
    its heterogeneity is 1. If the model does not contain any connectors, the
    measure is undefined and this method returns None.
    :param model: A Petri net in pm4py-format
    :return: The connector heterogeneity of the input model
    """
    def count_connectors(node_list):
        connectors = 0
        for node in node_list:
            if len(node.out_arcs) > 1 or len(node.in_arcs) > 1:
                connectors += 1
        return connectors
    and_connectors = count_connectors(model.places)
    xor_connectors = count_connectors(model.transitions)
    all_connectors = and_connectors + xor_connectors
    if all_connectors == 0:
        return None
    and_ratio = and_connectors / all_connectors
    xor_ratio = xor_connectors / all_connectors
    if and_ratio == 0 or xor_ratio == 0:
        return 0
    return -(and_ratio * math.log2(and_ratio) + xor_ratio * math.log2(xor_ratio))

def measure_cross_connectivity(model: PetriNet, detailed=False):
    """
    Returns the cross connectivity metric for the input model. This metric evaluates
    how strong the connections between nodes are. A connection is considered strong
    if both nodes are always 'visited' together in any control flow. Therefore, the
    algorithm assigns a weight of 1/deg(v) to any xor-connector v in the model, where
    deg(v) is the degree of v (the amount of incoming and outgoing arcs). All other
    nodes have weight 1. The weight of an edge (u,v) is w(u) * w(v). The weight of
    a path v1,...,vk is w(v1)*...*w(vk). The value of a connection between two nodes
    u and v is the maximum weight of a path between u and v. The cross connectivity
    is one minus the mean value of any connection. This algorithm calculates the
    cross connectivity metric by calculating all simple paths and finding the length
    of the longest one and is therefore runtime-heavy, as this must be done for all
    pairs of nodes in the model. Using Dijkstra instead would not work because the
    logarithm of all edge weights is <= 0. Bellman-Ford would also not work, because
    it is possible to have loops with negative total weight.
    :param model: A Petri net in pm4py-format
    :param detailed: A boolean deciding whether to print the whole value table
    :return: The cross connectivity metric for the net
    """
    model_graph = transform_to_networkx(model)
    # calculate the weights of nodes in the graph
    node_weights = {}
    for node in model_graph.nodes:
        node_weights[node] = 1
        # check if the node n is a xor-split. If so, its weight is 1 / deg(n)
        if type(node) is PetriNet.Place and (len(node.in_arcs) > 1 or len(node.out_arcs) > 1):
            node_weights[node] = 1 / (len(node.in_arcs) + len(node.out_arcs))
    # calculate the weights of edges in the graph
    for edge in model_graph.edges:
        model_graph.edges[edge]['weight'] = node_weights[edge[0]] * node_weights[edge[1]]
    # define a method for calculating paths starting and ending at the same node
    def get_all_cyclic_paths(start):
        # calculate all simple paths from start to any other node
        all_simple_paths_to_other_nodes = []
        for end in model_graph.nodes:
            all_simple_paths_to_other_nodes += list(networkx.all_simple_paths(model_graph, start, end))
        # find single loop iterations based on the simple paths
        single_loop_iterations = []
        for path in all_simple_paths_to_other_nodes:
            first_node = path[0]
            last_node = path[-1]
            if model_graph.has_edge(last_node, first_node):
                single_loop_iterations += [path + [first_node]]
        return single_loop_iterations
    # define a method for calculating all paths
    def get_all_paths(start, end):
        # calculate all simple paths from start to end, as Dijkstra and Bellman-Ford are not applicable here
        all_simple_paths = list(networkx.all_simple_paths(model_graph, start, end))
        # remove path that consist of only a single node
        all_simple_paths = [path for path in all_simple_paths if len(path) > 1]
        if start == end:
            all_simple_paths += get_all_cyclic_paths(start)
        return all_simple_paths
    # define a method for calculating path weights
    def path_weight(simple_path):
        weight = 1
        for i in range(len(simple_path)-1):
            weight *= model_graph.edges[simple_path[i], simple_path[i+1]]['weight']
        return weight
    # sum the maximum weights of each path
    sum_of_path_weights = 0
    values = [["V(u,v)"] + [str(u) for u in model_graph.nodes]]
    for u in model_graph.nodes:
        u_val = [str(u)]
        for v in model_graph.nodes:
            # calculate all paths from u to v
            all_paths = get_all_paths(u, v)
            # find the longest path of the ones found
            if len(all_paths) > 0:
                highest_path_weight = max([path_weight(path) for path in all_paths])
                u_val += [str(round(highest_path_weight, 5))]
                sum_of_path_weights += highest_path_weight
            else:
                u_val += ["0"]
        values += [u_val]
    if detailed:
        print(tabulate(values, headers='firstrow', tablefmt='fancy_grid'))
    maximum_sum_of_path_weights = len(model_graph.nodes) * len(model_graph.nodes)
    cross_connectivity = 1 - (sum_of_path_weights / maximum_sum_of_path_weights)
    return cross_connectivity


def measure_token_split(model: PetriNet):
    """
    Returns the number of arcs leaving transitions that split a token into multiple
    tokens. For example, if a transition has three out-going arcs, its impact on this
    complexity measure is 2, since 2 of the arcs create new tokens, while one arc
    can 'reuse' the already existing token.
    :param model: A Petri net in pm4py-format
    :return: The sum of arcs leaving transitions minus the amount of transitions
    """
    token_split = 0
    for transition in model.transitions:
        if len(transition.out_arcs) > 1:
            token_split += len(transition.out_arcs) - 1
    return token_split

def measure_control_flow_complexity(model: PetriNet):
    """
    Returns the control flow complexity of this model, which is the perceived
    complexity of following all possible control flows through the net. Parallel
    splits introduce some complexity, but don't increase the number of control
    flows, so their impact on complexity is 1 each. Exclusive choice splits, on the
    other hand, add one possible control flow per arc, so their impact on complexity
    is the number of leaving arcs.
    :param model: A Petri net in pm4py-format
    :return: The amount of parallel splits plus the amount of arcs leaving exclusive choice splits
    """
    and_connector_impact = 0
    for transition in model.transitions:
        if len(transition.out_arcs) > 1:
            and_connector_impact += 1
    xor_connector_impact = 0
    for place in model.places:
        if len(place.out_arcs) > 1:
            xor_connector_impact += len(place.out_arcs)
    return and_connector_impact + xor_connector_impact

def measure_separability(model: PetriNet):
    """
    Returns the ratio of nodes that are no articulation points
    if we interpret the model as an undirected graph.
    :param model: A Petri net in pm4py-format
    :return: The ratio of nodes that aren't articulation points in the net
    """
    model_graph = transform_to_networkx(model, undirected=True)
    number_of_cut_vertices = len(list(networkx.articulation_points(model_graph)))
    return 1 - (number_of_cut_vertices / (len(model.places) + len(model.transitions)))

def measure_average_connector_degree(model: PetriNet):
    """
    Returns the average degree of connectors in the Petri net.
    :param model: A Petri net in pm4py-format
    :return: The average number of incoming and outgoing arcs of a connector in the net
    """
    sum_of_degrees = 0
    number_of_connectors = 0
    for place in model.places:
        if len(place.in_arcs) > 1 or len(place.out_arcs) > 1:
            sum_of_degrees += len(place.in_arcs) + len(place.out_arcs)
            number_of_connectors += 1
    for transition in model.transitions:
        if len(transition.in_arcs) > 1 or len(transition.out_arcs) > 1:
            sum_of_degrees += len(transition.in_arcs) + len(transition.out_arcs)
            number_of_connectors += 1
    if number_of_connectors == 0:
        return None
    return sum_of_degrees / number_of_connectors

def measure_maximum_connector_degree(model: PetriNet):
    """
    Returns the maximum degree of a connector in the model.
    :param model: A Petri net in pm4py-format
    :return: The maximum degree of a connector in the Petri net
    """
    maximum_degree = 0
    for place in model.places:
        if len(place.in_arcs) > 1 or len(place.out_arcs) > 1:
            degree = len(place.in_arcs) + len(place.out_arcs)
            if degree > maximum_degree:
                maximum_degree = degree
    for transition in model.transitions:
        if len(transition.in_arcs) > 1 or len(transition.out_arcs) > 1:
            degree = len(transition.in_arcs) + len(transition.out_arcs)
            if degree > maximum_degree:
                maximum_degree = degree
    return maximum_degree

def measure_sequentiality(model: PetriNet):
    """
    Returns the sequentiality of the model, which is the amount of arcs
    between nodes out of which at least one is a connector node, divided
    by the total amount of arcs in the model.
    :param model: A Petri net in pm4py-format
    :return: The ratio of sequential arcs in the net
    """
    sequentiality = 0
    connectors = set()
    for place in model.places:
        if len(place.in_arcs) > 1 or len(place.out_arcs) > 1:
            connectors.add(place)
    for transition in model.transitions:
        if len(transition.in_arcs) > 1 or len(transition.out_arcs) > 1:
            connectors.add(transition)
    for arc in model.arcs:
        if arc.source not in connectors and arc.target not in connectors:
            sequentiality += 1
    sequentiality = 1 - (sequentiality / len(model.arcs))
    return sequentiality

def measure_depth(model: PetriNet, initial_marking: Marking, final_marking: Marking):
    """
    Calculates the maximum depth of a node in the model. The depth of a node
    is the minimum of its in-depth and its out-depth. The in-depth of a node
    is the maximum number of split-nodes encountered without a following
    join-node in a path from a start-node (one that is initially marked) to
    the node. The out-depth of a node is the maximum number of join-nodes
    encountered in a path from the node to a final node (one that contains a
    token in the final marking) that without a preceding split-node in the
    same path.
    :param model: A Petri net in pm4py-format
    :param initial_marking: The initial marking of the Petri net, in pm4py-format
    :param final_marking: The final marking of the Petri net, in pm4py-format
    :return: The maximum depth of a node in the net
    """
    model_graph = transform_to_networkx(model)
    # initialize the in_depth and the out_depth of each node with 0
    in_depth = {}
    out_depth = {}
    for node in model_graph.nodes:
        in_depth[node] = 0
        out_depth[node] = 0
    # go through all nodes in a breadth first search, starting from a start node, and update the in_depth
    for start_node in initial_marking.keys():
        bfs_tree = networkx.bfs_tree(model_graph, start_node)
        queue = [start_node]
        while len(queue) > 0:
            current_node = queue.pop(0)
            # add all neighbors of the current node to the queue
            queue += [neighbor for neighbor in bfs_tree[current_node]]
            # get the parent nodes, of which there can be only 0 (if the current node is the root) or 1 (otherwise)
            parents = [edge[0] for edge in bfs_tree.in_edges(current_node)]
            if len(parents) != 0:
                parent = parents[0] # in a tree each node, except for the root, has exactly one parent
                if len(parent.out_arcs) > 1 >= len(current_node.in_arcs):
                    in_depth[current_node] = max(in_depth[current_node], in_depth[parent] + 1)
                elif len(current_node.in_arcs) > 1 >= len(parent.out_arcs):
                    in_depth[current_node] = max(in_depth[current_node], in_depth[parent] - 1)
                else:
                    in_depth[current_node] = max(in_depth[current_node], in_depth[parent])
    # go through all nodes in a reversed breadth first search, starting from a final node, and update the out_depth
    for final_node in final_marking.keys():
        bfs_tree = networkx.bfs_tree(model_graph, final_node, reverse=True)
        queue = [final_node]
        while len(queue) > 0:
            current_node = queue.pop(0)
            # add all neighbors of the current node to the queue
            queue += [neighbor for neighbor in bfs_tree[current_node]]
            # get the parent nodes, of which there can be only 0 (if the current node is the root) or 1 (otherwise)
            parents = [edge[0] for edge in bfs_tree.in_edges(current_node)]
            if len(parents) != 0:
                parent = parents[0] # in a tree each node, except for the root, has exactly one parent
                if len(parent.in_arcs) > 1 >= len(current_node.out_arcs):
                    out_depth[current_node] = max(out_depth[current_node], out_depth[parent] + 1)
                elif len(current_node.out_arcs) > 1 >= len(parent.in_arcs):
                    out_depth[current_node] = max(out_depth[current_node], out_depth[parent] - 1)
                else:
                    out_depth[current_node] = max(out_depth[current_node], out_depth[parent])
    # calculate the depth of each node
    maximum_depth = -math.inf
    for node in model_graph.nodes:
        depth = min(in_depth[node], out_depth[node])
        if depth > maximum_depth:
            maximum_depth = depth
    return maximum_depth

def measure_diameter(model: PetriNet, initial_marking: Marking, final_marking: Marking):
    """
    Returns the diameter of the PetriNet, if interpreted as a directed graph.
    In other words, if we consider all places and transitions to be nodes in the
    graph and keep the edges as in the Petri net, this method returns the size
    of the longest acyclic path from a start node to an end node.
    Start nodes are all nodes that are marked in the initial marking, end nodes
    are all nodes that contain a token in the final marking.
    :param model: A Petri net in pm4py-format
    :param initial_marking: The initial marking of the Petri net in pm4py-format
    :param final_marking: The final marking of the Petri net in pm4py-format
    :return: The longest acyclic path from an initially marked place to a finally marked place
    """
    # Create a networkx graph that represents the Petri net
    model_graph = transform_to_networkx(model)
    all_nodes = model_graph.nodes
    # calculate the longest path-length between a start and end node
    maximum_path_length = -math.inf
    # a start node is a node that is marked initially
    for start_node in all_nodes:
        # an end node is a node that contains a token in the final marking
        for end_node in all_nodes:
            all_paths = list(networkx.all_simple_paths(model_graph, start_node, end_node))
            if len(all_paths) == 0:
                longest_acyclic_path_length = -math.inf
            else:
                longest_acyclic_path_length = len(max(all_paths, key=lambda path: len(path)))
            if longest_acyclic_path_length > maximum_path_length:
                maximum_path_length = longest_acyclic_path_length
    return maximum_path_length

def measure_cyclicity(model: PetriNet):
    """
    Returns the cyclicity of the input model, i.e. the ratio of
    nodes in the model that lie on a cycle.
    :param model: A Petri net in pm4py-format
    :return: The ratio of nodes that lie on a cycle in the net
    """
    # Create a networkx graph that represents the Petri net
    model_graph = transform_to_networkx(model)
    # Calculate all cycles in the model graph
    cycles = networkx.simple_cycles(model_graph)
    # Create a set of nodes that lie on cycles
    nodes_on_cycles = set()
    for cycle in cycles:
        for node in cycle:
            nodes_on_cycles.add(node)
    return len(nodes_on_cycles) / (len(model.places) + len(model.transitions))

def measure_coefficient_of_network_connectivity(model: PetriNet):
    """
    Returns the coefficient of network connectivity of the model, which is
    the amount of arcs divided by the amount of nodes in the model.
    :param model: A Petri net in pm4py-format
    :return: The amount of arcs divided by the amount of nodes in the net
    """
    return len(model.arcs) / (len(model.places) + len(model.transitions))

def measure_density(model: PetriNet):
    """
    Returns the density of the input model, i.e., the number of arcs divided
    by the total possible amount of arcs. Since a Petri net is a bipartite
    graph, there can be at most 2 * |T| * |P| directed edges (where T is the
    set of transitions and P is the set of places).
    :param model: A Petri net in pm4py-format
    :return: The amount of arcs divided by 2 * |T| * |P|, where T is the set of transitions and P the set of places
    """
    number_of_arcs = len(model.arcs)
    maximum_number_of_arcs = 2 * len(model.transitions) * len(model.places)
    return number_of_arcs / maximum_number_of_arcs

def measure_number_of_duplicate_tasks(model: PetriNet):
    """
    Returns the number of repetitions in transition labels in the model.
    For example, if the transition label "a" occurs three times in the
    net, and all other transition labels occur once, this method returns 2,
    because the label "a" was repeated two times.
    :param model: A Petri net in pm4py-format
    :return: The number of repetitions of transition labels in the net
    """
    encountered_transition_labels = set()
    duplicates = 0
    for transition in model.transitions:
        if transition.label in encountered_transition_labels:
            duplicates += 1
        encountered_transition_labels.add(transition.label)
    return duplicates

def measure_empty_sequence_flows(model: PetriNet):
    """
    Returns the number of empty sequence flows, which is the
    number of places that have just parallel splits in their
    preset and parallel joins in their postset.
    :param model: A Petri net in pm4py-format
    :return: The number of places with just parallel splits in their preset and parallel joins in their postset
    """
    empty_sequence_flows = 0
    for place in model.places:
        are_all_previous_and_splits = True
        for in_arc in place.in_arcs:
            if len(in_arc.source.out_arcs) <= 1:
                are_all_previous_and_splits = False
        are_all_next_and_joins = True
        for out_arc in place.out_arcs:
            if len(out_arc.target.in_arcs) <= 1:
                are_all_next_and_joins = False
        if are_all_previous_and_splits and are_all_next_and_joins:
            empty_sequence_flows += 1
    return empty_sequence_flows
