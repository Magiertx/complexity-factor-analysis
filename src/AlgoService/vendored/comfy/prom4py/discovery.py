from .model.cached_prom_object import CachedProMObject
from .client.prom_client import PluginInvocation


def mine_petri_net_with_inductive_miner_with_parameters(self, log, noise_threshold=0.2) \
        -> tuple[CachedProMObject, CachedProMObject, CachedProMObject]:
    log = self.check_log_type(log)
    name = 'mine_petri_net_with_inductive_miner_with_parameters'
    mining_params = self.client.call_executor(
        'org.processmining.plugins.InductiveMiner.mining.MiningParametersIMf parameters = new '
        'org.processmining.plugins.InductiveMiner.mining.MiningParametersIMf();\n'
        f'parameters.setNoiseThreshold((float) {noise_threshold});\n'
        'return parameters;'
    )

    parameters = [log.key, mining_params]
    signature = PluginInvocation(name, parameters)
    result = self.client.call_plugin(signature)
    result = result.split()

    return CachedProMObject(result[0], self.client), \
        CachedProMObject(result[1], self.client), \
        CachedProMObject(result[2], self.client)


def mine_petri_net_with_alpha_robust_miner(self, log):
    log = self.check_log_type(log)
    name = 'alpha_miner'
    classifier = self.client.call_executor("return new org.deckfour.xes.classification.XEventNameClassifier();")
    mining_params = self.client.call_executor(
        f"return new org.processmining.alphaminer.parameters.AlphaRobustMinerParameters("
        f"org.processmining.alphaminer.parameters.AlphaVersion.ROBUST);"
    )

    parameters = [log.key, classifier, mining_params]
    signature = PluginInvocation(name, parameters)
    result = self.client.call_plugin(signature)
    result = result.split()

    petri_net = CachedProMObject(result[0], self.client)
    initial_marking = CachedProMObject(result[1], self.client)
    final_marking = CachedProMObject(result[2], self.client) if len(result) > 2 else None
    return petri_net, initial_marking, final_marking


def mine_petri_net_with_alpha_miner_versions(self, log, version: str):
    version = version.upper()
    allowed_versions = {"CLASSIC", "DOLLAR", "PLUS", "PLUS_PLUS", "SHARP"}

    if version not in allowed_versions:
        raise ValueError(f"Invalid Alpha Miner version: {version}. Allowed values are: {', '.join(allowed_versions)}.")

    log = self.check_log_type(log)
    name = 'alpha_miner'
    classifier = self.client.call_executor("return new org.deckfour.xes.classification.XEventNameClassifier();")
    mining_params = self.client.call_executor(
        f"return new org.processmining.alphaminer.parameters.AlphaMinerParameters("
        f"org.processmining.alphaminer.parameters.AlphaVersion.{version});"
    )

    parameters = [log.key, classifier, mining_params]
    signature = PluginInvocation(name, parameters)
    result = self.client.call_plugin(signature)
    result = result.split()

    petri_net = CachedProMObject(result[0], self.client)
    initial_marking = CachedProMObject(result[1], self.client)
    final_marking = CachedProMObject(result[2], self.client) if len(result) > 2 else None
    return petri_net, initial_marking, final_marking


def mine_petri_net_with_heuristics_miner(self, log, relative_to_best_threshold: float = 0.05, positive_observation_threshold: int = 1, dependency_threshold: float = 0.9,
                                         l1l_threshold: float = 0.9, l2l_threshold: float = 0.9, long_distance_threshold: float = 0.9, dependency_divisor: int = 1, and_threshold: float = 0.1):
    invalid_params = []

    for name, value in {
        "relative_to_best_threshold": relative_to_best_threshold,
        "dependency_threshold": dependency_threshold,
        "l1l_threshold": l1l_threshold,
        "l2l_threshold": l2l_threshold,
        "long_distance_threshold": long_distance_threshold,
        "and_threshold": and_threshold,
    }.items():
        if not (0 <= value <= 1):
            invalid_params.append(f"{name} = {value} (expected 0 ≤ value ≤ 1)")

    for name, value in {
        "positive_observation_threshold": positive_observation_threshold,
        "dependency_divisor": dependency_divisor,
    }.items():
        if value < 1:
            invalid_params.append(f"{name} = {value} (expected value ≥ 1)")

    if invalid_params:
        raise ValueError("Invalid Heuristics Miner parameters:\n  " + "\n  ".join(invalid_params))

    log = self.check_log_type(log)
    name = 'mine_for_a_heuristics_net_using_heuristics_miner'
    mining_params = self.client.call_executor(
        f"org.deckfour.xes.classification.XEventClassifier cls = new org.deckfour.xes.classification.XEventNameClassifier();"
        f"org.processmining.plugins.heuristicsnet.miner.heuristics.miner.settings.HeuristicsMinerSettings s = new org.processmining.plugins.heuristicsnet.miner.heuristics.miner.settings.HeuristicsMinerSettings();"
        f"s.setClassifier(cls);"
        f"s.setRelativeToBestThreshold({relative_to_best_threshold});"
        f"s.setPositiveObservationThreshold({positive_observation_threshold});"
        f"s.setDependencyThreshold({dependency_threshold});"
        f"s.setL1lThreshold({l1l_threshold});"
        f"s.setL2lThreshold({l2l_threshold});"
        f"s.setLongDistanceThreshold({long_distance_threshold});"
        f"s.setDependencyDivisor({dependency_divisor});"
        f"s.setAndThreshold({and_threshold});"
        f"return s;"
    )

    parameters = [log.key, mining_params]
    signature = PluginInvocation(name, parameters)
    result = self.client.call_plugin(signature)
    result = result.split()

    heuristics_net = result[0]
    converter_signature = PluginInvocation("convert_heuristics_net_into_petri_net", [heuristics_net])
    converter_result = self.client.call_plugin(converter_signature)
    converter_result = converter_result.split()

    petri_net = CachedProMObject(converter_result[0], self.client)
    initial_marking = CachedProMObject(converter_result[1], self.client)
    final_marking = CachedProMObject(converter_result[2], self.client) if len(converter_result) > 2 else None
    return petri_net, initial_marking, final_marking


def mine_petri_net_with_directly_follows_miner(self, log):
    log = self.check_log_type(log)
    name = 'mine_petri_net_using_directly_follows_model_miner_with_parameters'
    mining_params = self.client.call_executor(
        "return new org.processmining.directlyfollowsmodelminer.mining.variants.DFMMiningParametersDefault();"
    )

    parameters = [log.key, mining_params]
    signature = PluginInvocation(name, parameters)
    result = self.client.call_plugin(signature)
    result = result.split()

    petri_net = CachedProMObject(result[0], self.client)
    initial_marking = CachedProMObject(result[1], self.client)
    final_marking = CachedProMObject(result[2], self.client) if len(result) > 2 else None
    return petri_net, initial_marking, final_marking


def mine_petri_net_with_flower_model_miner(self, log):
    log = self.check_log_type(log)
    name = 'mine_petri_net_using_flower_miner'

    parameters = [log.key]
    signature = PluginInvocation(name, parameters)
    result = self.client.call_plugin(signature)
    result = result.split()

    petri_net = CachedProMObject(result[0], self.client)
    initial_marking = CachedProMObject(result[1], self.client)
    final_marking = CachedProMObject(result[2], self.client)
    return petri_net, initial_marking, final_marking


def mine_petri_net_with_trace_net_miner(self, log):
    log = self.check_log_type(log)
    name = 'mine_process_tree_using_trace_miner'

    parameters = [log.key]
    signature = PluginInvocation(name, parameters)
    result = self.client.call_plugin(signature)
    result = result.split()

    process_tree = result[0]
    converter_signature = PluginInvocation("convert_process_tree_to_petri_net", [process_tree])
    converter_result = self.client.call_plugin(converter_signature)
    converter_result = converter_result.split()

    petri_net = CachedProMObject(converter_result[0], self.client)
    initial_marking = CachedProMObject(converter_result[1], self.client)
    final_marking = CachedProMObject(converter_result[2], self.client)
    return petri_net, initial_marking, final_marking


def mine_petri_net_with_hybrid_ilp_miner(self, log):
    log = self.check_log_type(log)
    name = 'ilp_based_process_discovery'
    classifier = self.client.call_executor("return new org.deckfour.xes.classification.XEventNameClassifier();")

    parameters = [log.key, classifier]
    signature = PluginInvocation(name, parameters)
    result = self.client.call_plugin(signature)
    result = result.split()

    petri_net = CachedProMObject(result[0], self.client)
    initial_marking = CachedProMObject(result[1], self.client)
    final_marking = CachedProMObject(result[2], self.client)
    return petri_net, initial_marking, final_marking