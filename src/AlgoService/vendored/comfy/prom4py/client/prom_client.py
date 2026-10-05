import os
import platform
import time
import warnings
from pathlib import Path
from subprocess import Popen
from dataclasses import dataclass

import json
import jsons
import requests
import atexit
import signal

from ..model.alignment_parameters import AlignmentParameters

PLUGIN_ENDPOINT = '/plugin'
EXECUTOR_ENDPOINT = '/executor'
CACHE_ENDPOINT = '/cache'
ARRAY_ENDPOINT = '/getResultFromArray'
EXPORT_LOG_ENDPOINT = '/exportLog'
EXPORT_ENDPOINT = '/export'
EXIT_ENDPOINT = '/exit'
IS_RUNNING_ENDPOINT = '/isRunning'
CREATE_ARRAY_OBJECT_ENDPOINT = '/createArrayObject'
TYPE_ENDPOINT = '/cache/type'
ALIGNMENT_ENDPOINT = '/align'


class PluginInvocation:
    def __init__(self, name, parameters):
        self.name = name
        self.parameters = parameters


class SerializedObject:
    def __init__(self, serialized_string):
        self.serialized_string = serialized_string


class CachedObject:
    def __init__(self, key):
        self.key = key


@dataclass
class ConnectionConfiguration:
    address: str = 'http://localhost:'
    port: int = 8000

    def get_url(self) -> str:
        return self.address + str(self.port)


class ProMClient:
    keys = []

    def __init__(self, path_to_prom: Path, port=8000, dev_mode=False):
        atexit.register(self.exit_handler)
        signal.signal(signal.SIGTERM, self.exit_handler)
        signal.signal(signal.SIGINT, self.exit_handler)
        self.config = ConnectionConfiguration(port=port)

        if dev_mode:
            return

        if not self.is_running():
            cwd = Path(path_to_prom).parent
            command = f'{path_to_prom} -p {port}'

            if platform.system() == 'Windows':
                from subprocess import CREATE_NEW_CONSOLE
                Popen(command, creationflags=CREATE_NEW_CONSOLE, cwd=cwd)
            elif platform.system() == 'Linux':
                Popen(command, shell=True, stdin=None, stdout=None, stderr=None, close_fds=True, cwd=cwd)
            else:
                raise RuntimeError("ProM4PY does not support OS X")

            while not self.is_running():
                time.sleep(1)
            print('ProM instance was started')

    def extract(self, key):
        res = requests.get(self.config.get_url() + CACHE_ENDPOINT + "?key=" + key)
        if res.status_code == 200:
            return res.text
        else:
            raise Exception(res.text)

    def post(self, serialized_object, class_name):
        res = requests.post(self.config.get_url() + CACHE_ENDPOINT + "?classname=" + class_name, data=serialized_object)
        if res.status_code == 200:
            self.keys.append(res.text)
            return res.text
        else:
            raise Exception(res.text)

    def delete_result(self, key):
        res = requests.delete(self.config.get_url() + CACHE_ENDPOINT + "?key=" + key)
        if res.status_code == 200:
            return res.text
        else:
            raise Exception(res.text)

    def get_result_from_array(self, key, index):
        res = requests.get(self.config.get_url() + ARRAY_ENDPOINT + "?key=" + key + "&index=" + str(index))
        return res.text

    def call_plugin(self, plugin_signature: PluginInvocation):
        res = requests.post(self.config.get_url() + PLUGIN_ENDPOINT,
                            data=json.dumps(jsons.dump(plugin_signature)))
        if res.status_code == 200:
            self.keys.append(res.text)
            return res.text
        else:
            raise Exception(res.text)

    def call_alignment(self, alignment_parameters: AlignmentParameters):
        res = requests.post(self.config.get_url() + ALIGNMENT_ENDPOINT,
                            data=json.dumps(jsons.dump(alignment_parameters)))
        if res.status_code == 200:
            self.keys.append(res.text)
            return res.text
        else:
            raise Exception(res.text)

    def call_executor(self, command):
        res = requests.post(self.config.get_url() + EXECUTOR_ENDPOINT, data=command)
        if res.status_code == 200:
            self.keys.append(res.text)
            return res.text
        else:
            raise Exception(res.text)

    def export_log(self, key, path):
        res = requests.get(self.config.get_url() + EXPORT_LOG_ENDPOINT + "?key=" + key + "&path=" + path)
        if res.status_code == 200:
            return res.text
        else:
            raise Exception(res.text)

    def create_array_object(self, key):
        res = requests.post(self.config.get_url() + CREATE_ARRAY_OBJECT_ENDPOINT + "?key=" + key)
        if res.status_code == 200:
            self.keys.append(res.text)
            return res.text
        else:
            raise Exception(res.text)

    def get_type(self, key):
        res = requests.get(self.config.get_url() + TYPE_ENDPOINT + "?key=" + key)
        if res.status_code == 200:
            return res.text
        else:
            return None

    def terminate(self):
        self.exit_handler()
        requests.post(self.config.get_url() + EXIT_ENDPOINT)

    def is_running(self) -> bool:
        try:
            res = requests.get(self.config.get_url() + IS_RUNNING_ENDPOINT)
            if res.status_code == 200 and res.text == 'ProM is running':
                return True
            else:
                raise Exception('Port already in use. Please pick another port.')
        except requests.exceptions.ConnectionError:
            return False

    def exit_handler(self):
        if self.is_running():
            for key in self.keys:
                if ' ' in key:
                    multiple_keys = key.split()
                    for k in multiple_keys:
                        self.delete_result(k)
                else:
                    self.delete_result(key)
            self.keys = []
