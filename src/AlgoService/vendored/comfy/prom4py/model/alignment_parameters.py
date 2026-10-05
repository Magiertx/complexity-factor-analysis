class AlignmentParameters:
    def __init__(self, petrinet_key, log_key, marking_key, mapping, replay_algorithm, replay_parameter):
        self.petrinetKey = petrinet_key
        self.logKey = log_key
        self.markingKey = marking_key
        self.mapping = mapping
        self.replayAlgorithm = replay_algorithm
        self.replayParameter = replay_parameter
