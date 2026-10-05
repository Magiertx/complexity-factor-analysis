from pm4py import Marking, PetriNet


class AcceptingPetriNet:
    def __init__(self, net: PetriNet, initial_marking: Marking, final_marking: Marking):
        self.net = net
        self.initial_marking = initial_marking
        self.final_marking = final_marking
