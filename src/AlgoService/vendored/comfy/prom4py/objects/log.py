from ..client.prom_client import PluginInvocation
from typing import Union
from pandas import DataFrame
from pm4py.objects.log.obj import EventLog
from pm4py.objects.conversion.log import converter as log_converter
from pm4py.objects.log.exporter.xes.exporter import serialize as serialize_log
from ..model.cached_prom_object import CachedProMObject


def check_log_type(self, log) -> CachedProMObject:
    if isinstance(log, CachedProMObject):
        return log
    elif isinstance(log, Union[DataFrame, EventLog]):
        return self.import_log(log)
    else:
        raise TypeError('Log must be type CachedProMObject or Union[DataFrame, EventLog].')


def import_log(self, log: Union[DataFrame, EventLog]) -> CachedProMObject:
    log = log_converter.apply(log, variant=log_converter.Variants.TO_EVENT_LOG,
                              parameters={"stream_postprocessing": True})
    serialized_log = serialize_log(log)
    key = self.client.post(serialized_log, 'org.deckfour.xes.model.impl.XLogImpl')
    return CachedProMObject(key, self.client)


def open_xes_log_file(self, file_path: str) -> CachedProMObject:
    name = 'open_xes_log_file'
    parameters = [file_path]
    signature = PluginInvocation(name, parameters)
    result = self.client.call_plugin(signature)
    return CachedProMObject(result, self.client)
