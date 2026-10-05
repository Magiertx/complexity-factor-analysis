class CostBasedCompleteParam:
    def __init__(self, max_num_of_states: int = 200000, default_move_on_model_cost: int = 2,
                 default_move_on_log_cost: int = 5, map_ev_class_2_cost: dict = None, map_trans_2_cost: dict = None,
                 map_sync_2_cost: dict = None, use_partial_ordered_events: bool = False):
        """
        Create a cost based complete parameter for the petrinet replay algorithm. On the Java side this gets mapped to
        the corresponding Java object.

        :param max_num_of_states: Maximum number of states
        :param default_move_on_model_cost: Default cost for every move on the model
        :param default_move_on_log_cost: Default cost for every move on the log
        :param map_ev_class_2_cost: Dict which maps a cost to every event (event is the key)
        :param map_trans_2_cost: Dict which maps a cost to every transition (transition is the key)
        :param map_sync_2_cost: Dict which maps a cost to every sync move (transition is the key)
        :param use_partial_ordered_events: if true, events with same timestamps are treated as partially ordered
        """
        self.typeInfo = 'CostBasedCompleteParam'
        self.maxNumOfStates = max_num_of_states
        self.defMoveOnModelCost = default_move_on_model_cost
        self.defMoveOnLogCost = default_move_on_log_cost
        self.mapEvClass2Cost = map_ev_class_2_cost
        self.mapTrans2Cost = map_trans_2_cost
        self.mapSync2Cost = map_sync_2_cost
        self.usePartialOrderedEvents = use_partial_ordered_events
        self.guiMode = False
        self.createConn = False
