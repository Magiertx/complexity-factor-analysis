from pm4py.objects.log.importer.xes.variants.iterparse import import_from_string
from pm4py.objects.conversion.log import converter as log_converter
from pm4py.objects.log.util import dataframe_utils


def deserialize_log(serialized_log: str):
    log = import_from_string(serialized_log)
    log = log_converter.apply(log, variant=log_converter.Variants.TO_DATA_FRAME)
    log = dataframe_utils.convert_timestamp_columns_in_df(log)
    return log
