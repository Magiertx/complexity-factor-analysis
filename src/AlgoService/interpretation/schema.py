"""Output schema of an interpretation, and the checks applied to what the model returns."""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field

MAX_NAME = 120
MAX_SUMMARY = 1500
MAX_OVERALL = 3000
MAX_CAVEATS = 10


class FactorInterpretation(BaseModel):
    index: int = Field(description="Number of the factor, starting at 1 as in 'Factor 1'.")
    name: str = Field(description="Short name of the factor, a few words.")
    summary: str = Field(description="Two or three sentences on what the factor captures and why.")
    driving_measures: list[str] = Field(
        description="Measures the interpretation rests on, exactly as named in the input, strongest first."
    )
    confidence: Literal["low", "medium", "high"]


class Interpretation(BaseModel):
    factors: list[FactorInterpretation]
    overall: str = Field(description="One short paragraph on the analysis as a whole.")
    caveats: list[str] = Field(description="Limitations a reader should know, one sentence each.")


def tidy(result: Interpretation, measures: list[str], n_factors: int) -> Interpretation:
    """Keep one entry per existing factor in order, drop measures the analysis does not have
    and cut overlong texts."""
    known = set(measures)
    factors: dict[int, FactorInterpretation] = {}
    for f in result.factors:
        if 1 <= f.index <= n_factors and f.index not in factors:
            driving = list(dict.fromkeys(m for m in f.driving_measures if m in known))
            factors[f.index] = FactorInterpretation(
                index=f.index,
                name=f.name.strip()[:MAX_NAME],
                summary=f.summary.strip()[:MAX_SUMMARY],
                driving_measures=driving,
                confidence=f.confidence,
            )
    return Interpretation(
        factors=[factors[i] for i in sorted(factors)],
        overall=result.overall.strip()[:MAX_OVERALL],
        caveats=[c.strip()[:MAX_SUMMARY] for c in result.caveats if c.strip()][:MAX_CAVEATS],
    )
