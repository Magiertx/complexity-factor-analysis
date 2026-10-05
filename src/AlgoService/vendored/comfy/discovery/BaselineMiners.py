from pm4py.objects.petri_net.obj import PetriNet, Marking # for creating marked Petri nets
from pm4py.objects.petri_net.utils import petri_utils # for adding edges between places and transitions in a Petri net

def trace_net_miner(pm4py_log):
    net = PetriNet("trace-net")
    from pm4py.algo.filtering.log.variants import variants_filter
    trace_variants = list(variants_filter.get_variants(pm4py_log).keys())
    # initialize the source and sink of the trace net
    source = PetriNet.Place("source")
    net.places.add(source)
    sink = PetriNet.Place("sink")
    net.places.add(sink)
    transition_number = 1
    place_number = 1
    # go through all traces and add the trace as a simple path from source to sink
    for trace in trace_variants:
        previous_place = source
        for i in range(len(trace)):
            event = trace[i]
            transition = PetriNet.Transition("t-" + str(transition_number), event)
            transition_number += 1
            net.transitions.add(transition)
            petri_utils.add_arc_from_to(previous_place, transition, net)
            if i == len(trace) - 1:
                previous_place = sink
            else:
                previous_place = PetriNet.Place("p-" + str(place_number))
                place_number += 1
                net.places.add(previous_place)
            petri_utils.add_arc_from_to(transition, previous_place, net)
    # define the initial and final marking of the trace net
    initial_marking = Marking()
    initial_marking[source] = 1
    final_marking = Marking()
    final_marking[sink] = 1
    return net, initial_marking, final_marking

def flower_miner(pm4py_log):
    net = PetriNet("flower-model")
    source = PetriNet.Place("source")
    net.places.add(source)
    tau1 = PetriNet.Transition("tau1", None)
    net.transitions.add(tau1)
    petri_utils.add_arc_from_to(source, tau1, net)
    middle = PetriNet.Place("middle")
    net.places.add(middle)
    petri_utils.add_arc_from_to(tau1, middle, net)
    tau2 = PetriNet.Transition("tau2", None)
    net.transitions.add(tau2)
    petri_utils.add_arc_from_to(middle, tau2, net)
    sink = PetriNet.Place("sink")
    net.places.add(sink)
    petri_utils.add_arc_from_to(tau2, sink, net)
    events = set()
    from pm4py.algo.filtering.log.variants import variants_filter
    trace_variants = list(variants_filter.get_variants(pm4py_log).keys())
    transition_number = 1
    for trace in trace_variants:
        for i in range(len(trace)):
            event = trace[i]
            if event not in events:
                t = PetriNet.Transition("t-" + str(transition_number), event)
                net.transitions.add(t)
                petri_utils.add_arc_from_to(t, middle, net)
                petri_utils.add_arc_from_to(middle, t, net)
                events.add(event)
                transition_number += 1
    # define the initial and final marking of the flower model
    initial_marking = Marking()
    initial_marking[source] = 1
    final_marking = Marking()
    final_marking[sink] = 1
    return net, initial_marking, final_marking
