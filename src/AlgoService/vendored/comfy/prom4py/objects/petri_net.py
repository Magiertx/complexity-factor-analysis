from pm4py import PetriNet
from pm4py import Marking
from pm4py.objects.petri_net.exporter.exporter import serialize as serialize_net

from ..model.accepting_petrinet import AcceptingPetriNet
from ..client.prom_client import PluginInvocation
from ..model.cached_prom_object import CachedProMObject


def check_net_type(self, net):
    if isinstance(net, CachedProMObject):
        return net
    elif isinstance(net, PetriNet):
        net, im = self.import_net(net)
        return net
    else:
        raise TypeError('Net must be type CachedProMObject or PetriNet.')


def check_net_and_marking_type(self, net, marking) -> tuple[CachedProMObject, CachedProMObject]:
    if isinstance(net, PetriNet) and isinstance(marking, Marking):
        return self.import_net(net, marking)
    if isinstance(net, PetriNet) and isinstance(marking, CachedProMObject):
        return self.import_net(net, None)
    if isinstance(net, CachedProMObject) and isinstance(marking, Marking):
        net, im, fm = net.extract()
        return self.import_net(net, marking)
    if isinstance(net, CachedProMObject) and isinstance(marking, CachedProMObject):
        return net, marking
    else:
        raise TypeError("Net must be type Petrinet or CachedProMObject and marking must be type Marking or "
                        "CachedProMObject.")


def check_accepting_net_type(self, net):
    if isinstance(net, CachedProMObject):
        return net
    elif isinstance(net, AcceptingPetriNet):
        net = self.import_accepting_net(net)
        return net
    else:
        raise TypeError('Net must be type CachedProMObject or AcceptingPetriNet.')


def import_net(self, net, initial_marking=None, final_marking=None) \
        -> tuple[CachedProMObject, CachedProMObject]:
    # return self.import_net_with_plugin(net, initial_marking, final_marking)
    if initial_marking is None:
        initial_marking = Marking()
        source = PetriNet.Place("source")
        initial_marking[source] = 1
    serialized_net = serialize_net(net, initial_marking, final_marking)
    keys = self.client.post(serialized_net,
                            'org.processmining.models.graphbased.directed.petrinet.impl.PetrinetImpl')
    keys = keys.split()
    return CachedProMObject(keys[0], self.client), CachedProMObject(keys[1], self.client)


def import_accepting_net(self, net: AcceptingPetriNet) -> CachedProMObject:
    serialized_net = serialize_net(net.net, net.initial_marking, net.final_marking)
    key = self.client.post(serialized_net, 'org.processmining.acceptingpetrinet.models.impl.AcceptingPetriNetImpl')
    return CachedProMObject(key, self.client)


def create_accepting_petri_net(self, net) -> CachedProMObject:
    """

    :param self:
    :param net: Petri net as Petri net or CachedProMObject
    :return: Accepting Petrinet as a CachedProMObject
    """
    net = self.check_net_type(net)
    name = 'create_accepting_petri_net'
    parameters = [net.key]
    signature = PluginInvocation(name, parameters)
    result = self.client.call_plugin(signature)
    return CachedProMObject(result, self.client)


def import_petri_net_from_pnml_file(self, path: str) -> tuple[CachedProMObject, CachedProMObject]:
    name = 'import_petri_net_from_pnml_file'
    parameters = [path]
    signature = PluginInvocation(name, parameters)
    result = self.client.call_plugin(signature)
    result = result.split()
    return CachedProMObject(result[0], self.client), CachedProMObject(result[1], self.client)


def pnml_export_petri_net_(self, net: CachedProMObject, path: str):
    name = 'pnml_export_petri_net_'
    path = path.replace('\\', '/')
    file = self.client.call_executor(f'new File(\"{path}\");')
    parameters = [net, file]
    signature = PluginInvocation(name, parameters)
    self.client.call_plugin(signature)


def reduce_using_murata_rules(self, accepting_net) -> CachedProMObject:
    """

    :param self:
    :param accepting_net: An accepting Petri net as CachedProMObject or AcceptingPetriNet
    :return: An accepting Petri net as CachedProMObject
    """
    accepting_net = self.check_accepting_net_type(accepting_net)
    name = 'reduce_using_murata_rules'
    parameters = [accepting_net.key]
    invocation = PluginInvocation(name, parameters)
    result = self.client.call_plugin(invocation)
    return CachedProMObject(result, self.client)


def decompose_accepting_petri_net_into_accepting_petri_net_array_by_sese_based_decomposition(
        self, accepting_net: CachedProMObject) -> CachedProMObject:
    """

    :param self:
    :param accepting_net: Accepting Petrinet as CachedProMObject
    :return: Accepting Petrinet Array as CachedProMObject
    """
    name = 'decompose_accepting_petri_net_into_accepting_petri_net_array_by_sese_based_decomposition'
    parameters = [accepting_net.key]
    signature = PluginInvocation(name, parameters)
    result = self.client.call_plugin(signature)
    return CachedProMObject(result, self.client)
