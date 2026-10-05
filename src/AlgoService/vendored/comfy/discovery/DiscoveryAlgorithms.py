from .. import Constants
from . import BaselineMiners, DirectlyFollowsMiner, DirectlyFollowsGraph
from ..prom4py import ProM4Py
from .._shared_prom4py import get_shared_prom4py

class TraceNetMiner:
    name = "Simple Trace Net miner"
    fname = "simple-trace-net-miner"

    def __str__(self):
        return self.name

    def discover_for(self, event_log):
        net, im, fm = BaselineMiners.trace_net_miner(event_log)
        return net, im, fm

class DirectlyFollowsGraphMiner:
    name = "Directly Follows graph"
    fname = "directly-follows-miner"

    def __str__(self):
        return self.name

    def discover_for(self, event_log):
        graph = DirectlyFollowsGraph.DirectlyFollowsGraph(event_log)
        return graph, None, None

class DirectlyFollowsModelMiner:
    name = "Directly Follows miner (baseline)"
    fname = "directly-fllows-miner-baseline"

    def __str__(self):
        return self.name

    def discover_for(self, event_log):
        net, im, fm = DirectlyFollowsMiner.directly_follows_miner(event_log)
        return net, im, fm

class InductiveMiner:
    name = "Inductive miner"
    fname = "inductive-miner"

    def __str__(self):
        return self.name

    def discover_for(self, event_log):
        prom4py = get_shared_prom4py()
        net, im, fm = prom4py.mine_petri_net_with_inductive_miner_with_parameters(event_log, noise_threshold=0)
        accepting_net = prom4py.create_accepting_petri_net(net).extract()
        return accepting_net.net, accepting_net.initial_marking, accepting_net.final_marking

class AlphaRobustMiner:
    name = "Alpha Robust miner"
    fname = "alpha-robust-miner"

    def __str__(self):
        return self.name

    def discover_for(self, event_log):
        prom4py = get_shared_prom4py()
        net, im, fm = prom4py.mine_petri_net_with_alpha_robust_miner(event_log)
        accepting_net = prom4py.create_accepting_petri_net(net).extract()
        return accepting_net.net, accepting_net.initial_marking, accepting_net.final_marking

class AlphaMiner:
    name = "Alpha miner"
    fname = "alpha-miner"

    def __str__(self):
        return self.name

    def discover_for(self, event_log):
        prom4py = get_shared_prom4py()
        net, im, fm = prom4py.mine_petri_net_with_alpha_miner_versions(event_log, version="CLASSIC")
        accepting_net = prom4py.create_accepting_petri_net(net).extract()
        return accepting_net.net, accepting_net.initial_marking, accepting_net.final_marking

class AlphaDollarMiner:
    name = "Alpha Dollar miner"
    fname = "alpha-dollar-miner"

    def __str__(self):
        return self.name

    def discover_for(self, event_log):
        prom4py = get_shared_prom4py()
        net, im, fm = prom4py.mine_petri_net_with_alpha_miner_versions(event_log, version="DOLLAR")
        accepting_net = prom4py.create_accepting_petri_net(net).extract()
        return accepting_net.net, accepting_net.initial_marking, accepting_net.final_marking

class AlphaPlusMiner:
    name = "Alpha Plus miner"
    fname = "alpha-plus-miner"

    def __str__(self):
        return self.name

    def discover_for(self, event_log):
        prom4py = get_shared_prom4py()
        net, im, fm = prom4py.mine_petri_net_with_alpha_miner_versions(event_log, version="PLUS")
        accepting_net = prom4py.create_accepting_petri_net(net).extract()
        return accepting_net.net, accepting_net.initial_marking, accepting_net.final_marking

class AlphaPlusPlusMiner:
    name = "Alpha Plus Plus miner"
    fname = "alpha-plus-plus-miner"

    def __str__(self):
        return self.name

    def discover_for(self, event_log):
        prom4py = get_shared_prom4py()
        net, im, fm = prom4py.mine_petri_net_with_alpha_miner_versions(event_log, version="PLUS_PLUS")
        accepting_net = prom4py.create_accepting_petri_net(net).extract()
        return accepting_net.net, accepting_net.initial_marking, accepting_net.final_marking

class AlphaSharpMiner:
    name = "Alpha Sharp miner"
    fname = "alpha-sharp-miner"

    def __str__(self):
        return self.name

    def discover_for(self, event_log):
        prom4py = get_shared_prom4py()
        net, im, fm = prom4py.mine_petri_net_with_alpha_miner_versions(event_log, version="SHARP")
        accepting_net = prom4py.create_accepting_petri_net(net).extract()
        return accepting_net.net, accepting_net.initial_marking, accepting_net.final_marking

class HeuristicsMiner:
    name = "Heuristics miner"
    fname = "heuristics-miner"

    def __str__(self):
        return self.name

    def discover_for(self, event_log):
        prom4py = get_shared_prom4py()
        net, im, fm = prom4py.mine_petri_net_with_heuristics_miner(event_log)
        accepting_net = prom4py.create_accepting_petri_net(net).extract()
        return accepting_net.net, accepting_net.initial_marking, accepting_net.final_marking

class DirectlyFollowsMinerProM4Py:
    name = "Directly Follows miner"
    fname = "directly-follows-miner"

    def __str__(self):
        return self.name

    def discover_for(self, event_log):
        prom4py = get_shared_prom4py()
        net, im, fm = prom4py.mine_petri_net_with_directly_follows_miner(event_log)
        accepting_net = prom4py.create_accepting_petri_net(net).extract()
        return accepting_net.net, accepting_net.initial_marking, accepting_net.final_marking

class FlowerModelMiner:
    name = "Flower Model miner"
    fname = "flower-model-miner"

    def __str__(self):
        return self.name

    def discover_for(self, event_log):
        prom4py = get_shared_prom4py()
        net, im, fm = prom4py.mine_petri_net_with_flower_model_miner(event_log)
        accepting_net = prom4py.create_accepting_petri_net(net).extract()
        return accepting_net.net, accepting_net.initial_marking, accepting_net.final_marking

class TraceNetMinerProM4Py:
    name = "Compact Trace Net miner"
    fname = "compact-trace-net-miner"

    def __str__(self):
        return self.name

    def discover_for(self, event_log):
        prom4py = get_shared_prom4py()
        net, im, fm = prom4py.mine_petri_net_with_trace_net_miner(event_log)
        accepting_net = prom4py.create_accepting_petri_net(net).extract()
        return accepting_net.net, accepting_net.initial_marking, accepting_net.final_marking

class HybridILPMiner:
    name = "Hybrid ILP miner"
    fname = "hybrid-ilp-miner"

    def __str__(self):
        return self.name

    def discover_for(self, event_log):
        prom4py = get_shared_prom4py()
        net, im, fm = prom4py.mine_petri_net_with_hybrid_ilp_miner(event_log)
        accepting_net = prom4py.create_accepting_petri_net(net).extract()
        return accepting_net.net, accepting_net.initial_marking, accepting_net.final_marking

# To add more discovery algorithms:
# 1. Create a class like the ones above. Its attributes should include "name", which is a descriptive name of
#    the discovery algorithm, shown when the user can choose the discovery algorithm they want to investigate.
#    Furthermore, your class must implement the functions __str__ (returning the name of the discovery algorithm)
#    and discover_for, which takes an event log and returns the model discovered by the discovery algorithm.
#    The result must consist of a net, an initial marking, and a final marking. If the latter two do not exist,
#    set them to None.
# 2. Add an instance of your new class to the following list of all discovery algorithms

analyzed_discovery_algorithms = [DirectlyFollowsMinerProM4Py(),AlphaMiner(), AlphaPlusMiner(),
                                 AlphaPlusPlusMiner(), AlphaDollarMiner(), AlphaRobustMiner(),
                                 InductiveMiner(), HeuristicsMiner(), HybridILPMiner()]

all_discovery_algorithms = [FlowerModelMiner(), TraceNetMiner(), TraceNetMinerProM4Py(), DirectlyFollowsGraphMiner(), DirectlyFollowsMinerProM4Py(),
                            DirectlyFollowsModelMiner(), AlphaMiner(), AlphaPlusMiner(), AlphaPlusPlusMiner(), AlphaSharpMiner(), AlphaDollarMiner(),
                            AlphaRobustMiner(), InductiveMiner(), HeuristicsMiner(), HybridILPMiner()]
