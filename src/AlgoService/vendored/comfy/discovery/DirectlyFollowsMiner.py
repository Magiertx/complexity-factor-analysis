from pm4py.objects.petri_net.obj import PetriNet, Marking # for creating marked Petri nets
from pm4py.objects.petri_net.utils import petri_utils # for adding edges between places and transitions in a Petri net

from . import DirectlyFollowsGraph as DFG # (internal) for calculating the DFG that defines the structure of the DFM


def directly_follows_miner(pm4py_log):
    net = PetriNet("directly-follows-model")
    dfg = DFG.DirectlyFollowsGraph(pm4py_log)
    transition_id = 1
    places = {}
    for node in dfg.graph.nodes:
        # create a place for each node in the directly follows graph
        places[node] = PetriNet.Place(node)
        net.places.add(places[node])
    for (source, target) in dfg.graph.edges:
        # if the target is the end node, create a silent transition
        if target == dfg.end:
            transition = PetriNet.Transition("t-" + str(transition_id), None)
        # otherwise create a transition with the label of the target
        else:
            transition = PetriNet.Transition("t-" + str(transition_id), target)
        net.transitions.add(transition)
        transition_id += 1
        # connect the source-place to the new transition
        petri_utils.add_arc_from_to(places[source], transition, net)
        # connect the transition to the target-place
        petri_utils.add_arc_from_to(transition, places[target], net)
    # define the initial and final marking of the directly follows model
    initial_marking = Marking()
    initial_marking[places[dfg.start]] = 1
    final_marking = Marking()
    final_marking[places[dfg.end]] = 1
    return net, initial_marking, final_marking

