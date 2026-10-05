from .client.prom_client import ProMClient
from .model.cached_prom_object import CachedProMObject


class ProM4Py:
    from .objects.log import check_log_type, import_log, open_xes_log_file
    from .objects.petri_net import check_net_type, import_net, create_accepting_petri_net, \
        import_petri_net_from_pnml_file, pnml_export_petri_net_, check_net_and_marking_type, \
        reduce_using_murata_rules, \
        decompose_accepting_petri_net_into_accepting_petri_net_array_by_sese_based_decomposition, \
        import_accepting_net, check_accepting_net_type
    from .conformance import replay_a_log_on_petri_net_for_conformance_analysis, convert_to_log_alignments, \
        calculate_alignment, map_log_to_net_on_transition_complete
    from .discovery import (
        mine_petri_net_with_inductive_miner_with_parameters,
        mine_petri_net_with_alpha_robust_miner,
        mine_petri_net_with_alpha_miner_versions,
        mine_petri_net_with_heuristics_miner,
        mine_petri_net_with_directly_follows_miner,
        mine_petri_net_with_flower_model_miner,
        mine_petri_net_with_trace_net_miner,
        mine_petri_net_with_hybrid_ilp_miner
    )


    def __init__(self, path_to_prom: str, port=8000, dev_mode=False):
        """
        Starts a new ProM instance if there is not one already running at the specified port.
        Also configures the http connection through a ProM Client.

        :param path_to_prom: Path in your system where the file that starts the ProM instance is located.
        :param port: Port where the ProM instance should run.
        :param dev_mode: Set true if ProM is running from a dev environment.
        """
        self.client = ProMClient(path_to_prom, port, dev_mode)

    def terminate(self):
        """
        Terminates the current running ProM instance.
        """
        self.client.terminate()

    def delete(self, obj: CachedProMObject):
        """
        Deletes the given object out of the cache from the ProM instance.
        :param obj: The CachedProMObject which should be deleted.
        """
        return self.client.delete_result(obj.key)
