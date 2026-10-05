import ast

from pm4py.objects.petri_net.importer.importer import deserialize as deserialize_petrinet

from ..util import deserialize_log
from .accepting_petrinet import AcceptingPetriNet
from ..client.prom_client import ProMClient


class CachedProMObject:
    def __init__(self, key, client: ProMClient):
        self.key = key
        self.client = client

    def extract(self):
        object_type = self.get_type()
        serialized_object = self.client.extract(self.key)
        match object_type:
            case 'XLogImpl':
                return deserialize_log(serialized_object)
            case 'PetrinetImpl':
                net, im, fm = deserialize_petrinet(serialized_object)
                return net, im, fm
            case 'LogAlignmentArrayImpl':
                return ast.literal_eval(serialized_object)
            case 'AcceptingPetriNetImpl':
                net, im, fm = deserialize_petrinet(serialized_object)
                return AcceptingPetriNet(net, im, fm)
            case _:
                return serialized_object

    def get_type(self):
        return self.client.get_type(self.key)

    def is_valid(self):
        return self.get_type() is not None
    
    def delete(self):
        self.client.delete_result(self.key)
