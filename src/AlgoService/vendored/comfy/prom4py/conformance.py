from enum import Enum

from pandas import DataFrame
from pm4py.util.xes_constants import DEFAULT_NAME_KEY, DEFAULT_TRANSITION_KEY

from .model.alignment_parameters import AlignmentParameters
from .model.cached_prom_object import CachedProMObject
from .model.replay_params.cost_based_complete_param import CostBasedCompleteParam
from .client.prom_client import PluginInvocation


class ReplayAlgorithms(Enum):
    A_STAR_PLUGIN = 'a_star_plugin'
    ITERATIVE_A_STAR_PLUGIN = 'iterative_a_star_plugin'
    PETRINET_REPLAYER_ILP_RESTRICTED_MOVE_MODEL = 'petrinet_replayer_ilp_restricted_move_model'
    PETRINET_REPLAYER_MOVE_PREFERENCE_AWARE_WITH_ILP = 'petrinet_replayer_move_preference_aware_with_ilp'
    PETRINET_REPLAYER_NO_ILP_RESTRICTED_MOVE_MODEL = 'petrinet_replayer_no_ilp_restricted_move_model'
    PETRINET_REPLAYER_SSD = 'petrinet_replayer_ssd'
    PETRINET_REPLAYER_WITH_ILP = 'petrinet_replayer_with_ilp'
    PETRINET_REPLAYER_WITHOUT_ILP = 'petrinet_replayer_without_ilp'
    PREFIX_BASED_PETRINET_REPLAYER = 'prefix_based_petrinet_replayer'
    BEHAVIORAL_APP_NAIVE_ALG = 'behav_app_naive_alg'
    BEHAVIORAL_APP_PRUNE_ALG = 'behav_app_prune_alg'
    BEHAVIORAL_APP_STUBBORN_ALG = 'behav_app_stubborn_alg'
    COST_BASED_COMPLETE_MARK_EQUATION = 'cost_based_complete_mark_equation'
    COST_BASED_COMPLETE_MARK_EQUATION_PRUNE = 'cost_based_complete_mark_equation_prune'
    COST_BASED_COMPLETE_NAIVE_ALG = 'cost_based_complete_naive_alg'
    COST_BASED_COMPLETE_PRUNE_ALG = 'cost_based_complete_prune_alg'
    COST_BASED_COMPLETE_RPST = 'cost_based_complete_rpst'
    COST_BASED_COMPLETE_RPST_PRUNE = 'cost_based_complete_rpst_prune'
    COST_BASED_PREFIX_ALG = 'cost_based_prefix_alg'
    PETRINET_SWAP_REPLAYER = 'petrinet_swap_replayer'
    SYNC_PRODUCT_ALG = 'sync_product_alg'


def replay_a_log_on_petri_net_for_conformance_analysis(self, log, net, im, mapping=None,
                                                       replay_algorithm=ReplayAlgorithms.A_STAR_PLUGIN,
                                                       replay_parameter=CostBasedCompleteParam()) \
        -> CachedProMObject:
    """
    Replays a log on a net for conformance analysis.

    :param self:
    :param log: Event Log (CachedProMObject or Dataframe)
    :param net: Petrinet (CachedProMObject or Petrinet)
    :param im: Initial marking
    :param mapping: Mapping between transitions and events as a dict of strings.
    Transition label is the key and the name of the event is the value
    :param replay_algorithm: Name of the replay algorithm. Use enum ReplayAlgorithm
    :param replay_parameter: Replay Parameter. Use one of the provided classes at model/replay_params
    :return: LogAlignment as a CachedProMObject
    """
    log = self.check_log_type(log)
    net, im = self.check_net_and_marking_type(net, im)
    parameters = AlignmentParameters(net.key, log.key, im.key, mapping, replay_algorithm.value, replay_parameter)
    key = self.client.call_alignment(parameters)
    return CachedProMObject(key, self.client)


def calculate_alignment(self, log, net, im, mapping: dict = None,
                        replay_algorithm=ReplayAlgorithms.PETRINET_REPLAYER_WITHOUT_ILP,
                        replay_parameter=CostBasedCompleteParam()) -> CachedProMObject:
    """
    First calculate a Petrinet Replay Result with replay_a_log_on_petri_net_for_conformance_analysis.
    Then convert this Replay Result to a LogAlignment.

    :param self:
    :param log: Event Log (CachedProMObject or Dataframe)
    :param net: Petrinet (CachedProMObject or Petrinet)
    :param im: Initial marking
    :param mapping: Mapping between transitions and events as a dict of strings.
    Transition label is the key and the name of the event is the value
    :param replay_algorithm: Name of the replay algorithm. Use enum ReplayAlgorithm
    :param replay_parameter: Replay Parameter. Use one of the provided classes at model/replay_params
    :return: LogAlignment as a CachedProMObject
    """
    log = self.check_log_type(log)
    net, im = self.check_net_and_marking_type(net, im)
    replay_result = self.replay_a_log_on_petri_net_for_conformance_analysis(log, net, im, mapping, replay_algorithm,
                                                                            replay_parameter)
    accepting_net = self.create_accepting_petri_net(net)
    alignment = self.convert_to_log_alignments(log, accepting_net, replay_result)
    return alignment


def convert_to_log_alignments(self, log, accepting_net,
                              replay_result: CachedProMObject) -> CachedProMObject:
    """
    Converts a Petrinet Replay Result to a LogAlignment

    :param self:
    :param log: Event Log (CachedProMObject or Dataframe)
    :param accepting_net: Accepting Petrinet as a CachedProMObject
    :param replay_result: Petrinet Replay Result as a CachedProMObject
    :return: LogAlignment as a CachedProMObject
    """
    log = self.check_log_type(log)
    accepting_net = self.check_accepting_net_type(accepting_net)
    log_array = CachedProMObject(self.client.create_array_object(log.key), self.client)
    accepting_net_array = CachedProMObject(self.client.create_array_object(accepting_net.key), self.client)
    replay_result_array = CachedProMObject(self.client.create_array_object(replay_result.key), self.client)
    name = 'convert_to_log_alignments'
    parameters = [log_array.key, accepting_net_array.key, replay_result_array.key]
    signature = PluginInvocation(name, parameters)
    result = self.client.call_plugin(signature)

    return CachedProMObject(result, self.client)


def map_log_to_net_on_transition_complete(self, log, net) -> dict:
    """
    Maps the event classes from the log to the transitions from the petrinet based on the name.
    It always maps the event class with the lifecycle transition "complete".
    Therefor this only works with logs which have the lifecycle transition attribute.

    :param self:
    :param log: Event log (CachedProMObject or Dataframe)
    :param net: Petrinet (CachedProMObject or Petrinet)
    :return: Mapping between transitions and event classes. Transitions are the keys of the dict.
    """
    if isinstance(log, CachedProMObject):
        log = log.extract()
    if isinstance(net, CachedProMObject):
        net, im, fm = net.extract()

    reduced_log: DataFrame = log[[DEFAULT_NAME_KEY, DEFAULT_TRANSITION_KEY]]
    reduced_log = reduced_log.drop_duplicates()
    reduced_log = reduced_log.reset_index()
    transitions = net.transitions
    mapping: dict = {}

    for transition in transitions:
        if transition.label is not None:
            trans, ev_class = None, None
            for index, row in reduced_log.iterrows():
                if row[DEFAULT_NAME_KEY] == transition.label:
                    trans = str(transition.label)
                    ev_class = f'{row[DEFAULT_NAME_KEY]}+{row[DEFAULT_TRANSITION_KEY]}'
                    if row[DEFAULT_TRANSITION_KEY] == 'complete':
                        continue
            mapping[trans] = ev_class

    return mapping
