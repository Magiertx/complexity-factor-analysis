from . import ModelComplexity

class Size:
    name = "Size"
    abbreviation = "size"

    def __str__(self):
        return self.name

    def calculate_for(self, model):
        return ModelComplexity.measure_size(model)

class ConnectorMismatch:
    name = "Connector Mismatch"
    abbreviation = "MM"

    def __str__(self):
        return self.name

    def calculate_for(self, model):
        return ModelComplexity.measure_connector_mismatch(model)

class ConnectorHeterogeneity:
    name = "Connector Heterogeneity"
    abbreviation = "CH"

    def __str__(self):
        return self.name

    def calculate_for(self, model):
        return ModelComplexity.measure_connector_heterogeneity(model)

class CrossConnectivity:
    name = "Cross-Connectivity"
    abbreviation = "CC"

    def __str__(self):
        return self.name

    def calculate_for(self, model):
        return ModelComplexity.measure_cross_connectivity(model)

class TokenSplit:
    name = "Token split"
    abbreviation = "ts"

    def __str__(self):
        return self.name

    def calculate_for(self, model):
        return ModelComplexity.measure_token_split(model)

class ControlFlowComplexity:
    name = "Control flow complexity"
    abbreviation = "CFC"

    def __str__(self):
        return self.name

    def calculate_for(self, model):
        return ModelComplexity.measure_control_flow_complexity(model)

class Separability:
    name = "Separability"
    abbreviation = "sep"

    def __str__(self):
        return self.name

    def calculate_for(self, model):
        return ModelComplexity.measure_separability(model)

class AverageConnectorDegree:
    name = "Average connector degree"
    abbreviation = "acd"

    def __str__(self):
        return self.name

    def calculate_for(self, model):
        return ModelComplexity.measure_average_connector_degree(model)

class MaximumConnectorDegree:
    name = "Maximum connector degree"
    abbreviation = "mcd"

    def __str__(self):
        return self.name

    def calculate_for(self, model):
        return ModelComplexity.measure_maximum_connector_degree(model)

class Sequentiality:
    name = "Sequentiality"
    abbreviation = "seq"

    def __str__(self):
        return self.name

    def calculate_for(self, model):
        return ModelComplexity.measure_sequentiality(model)

class Depth:
    name = "Depth"
    abbreviation = "depth"

    def __str__(self):
        return self.name

    def calculate_for(self, model, initial_marking=None, final_marking=None):
        if initial_marking is None or final_marking is None:
            raise Exception("Cannot calculate the Depth of the model without an initial and final marking.")
        return ModelComplexity.measure_depth(model, initial_marking, final_marking)

class Diameter:
    name = "Diameter"
    abbreviation = "diam"

    def __str__(self):
        return self.name

    def calculate_for(self, model, initial_marking=None, final_marking=None):
        if initial_marking is None or final_marking is None:
            raise Exception("Cannot calculate the Diameter of the model without an initial and final marking.")
        return ModelComplexity.measure_diameter(model, initial_marking, final_marking)

class Cyclicity:
    name = "Cyclicity"
    abbreviation = "cyc"

    def __str__(self):
        return self.name

    def calculate_for(self, model):
        return ModelComplexity.measure_cyclicity(model)

class CoefficientOfNetworkConnectivity:
    name = "Coefficient of network connectivity"
    abbreviation = "CNC"

    def __str__(self):
        return self.name

    def calculate_for(self, model):
        return ModelComplexity.measure_coefficient_of_network_connectivity(model)

class Density:
    name = "Density"
    abbreviation = "dens"

    def __str__(self):
        return self.name

    def calculate_for(self, model):
        return ModelComplexity.measure_density(model)

class NumberOfDuplicateTasks:
    name = "Number of duplicate tasks"
    abbreviation = "dup"

    def __str__(self):
        return self.name

    def calculate_for(self, model):
        return ModelComplexity.measure_number_of_duplicate_tasks(model)

class NumberOfEmptySequenceFlows:
    name = "Number of empty sequence flows"
    abbreviation = "emtpy-seq"

    def __str__(self):
        return self.name

    def calculate_for(self, model):
        return ModelComplexity.measure_empty_sequence_flows(model)

# To add more model complexity measures:
# 1. Create a class like the ones above. Its attributes should include "name", which is a descriptive name of
#    the model complexity measure, shown when the user can choose model complexity measures, and "abbreviation",
#    which is a short name for the measure shown in the tables of the analysis. Furthermore, your class must
#    implement the functions __str__ (returning the name of the measure) and calculate_for, which takes a
#    process model (possibly a Directly Follows Graph) and calculates the result of your measure for this model.
# 2. Add an instance of your new class to the following list of all model complexity measures.

analyzed_model_complexity_measures = [Size(), ConnectorMismatch(), ConnectorHeterogeneity(),
                                      TokenSplit(), ControlFlowComplexity(), Separability(),
                                      AverageConnectorDegree(), MaximumConnectorDegree(), Sequentiality(),
                                      CoefficientOfNetworkConnectivity(), Density(), NumberOfDuplicateTasks(),
                                      NumberOfEmptySequenceFlows()]

all_model_complexity_measures = [Size(), ConnectorMismatch(), ConnectorHeterogeneity(), CrossConnectivity(),
                                 TokenSplit(), ControlFlowComplexity(), Separability(), AverageConnectorDegree(),
                                 MaximumConnectorDegree(), Sequentiality(), Depth(), Diameter(), Cyclicity(),
                                 CoefficientOfNetworkConnectivity(), Density(), NumberOfDuplicateTasks(),
                                 NumberOfEmptySequenceFlows()]
