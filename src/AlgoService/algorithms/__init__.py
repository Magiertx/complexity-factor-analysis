"""Algorithm registry. Add a new algorithm by importing it here and
appending an instance to ``REGISTRY``.
"""

from .base import AlgorithmBase, AnalysisResult, ParameterSpec
from .comfy import ComFyAlgorithm

REGISTRY: dict[str, AlgorithmBase] = {
    ComFyAlgorithm.id: ComFyAlgorithm(),
}


def get(algorithm_id: str) -> AlgorithmBase | None:
    return REGISTRY.get(algorithm_id)


def all_algorithms() -> list[AlgorithmBase]:
    return list(REGISTRY.values())


__all__ = ["AlgorithmBase", "AnalysisResult", "ParameterSpec", "REGISTRY", "get", "all_algorithms"]
