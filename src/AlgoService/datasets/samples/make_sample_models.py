"""Regenerate the sample Petri nets in ``models/`` from the sample logs in ``logs/``.

Each log is mined with pm4py's inductive miner (infrequent variant) at several noise
thresholds, which gives nets of different size and structure for the same behaviour.

    cd src/AlgoService
    python datasets/samples/make_sample_models.py
"""

from __future__ import annotations

from pathlib import Path

import pm4py

HERE = Path(__file__).resolve().parent
NOISE_THRESHOLDS = (0.0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.8)


def main() -> None:
    out_dir = HERE / "models"
    out_dir.mkdir(exist_ok=True)
    for old in out_dir.glob("*.pnml"):
        old.unlink()
    for log_path in sorted((HERE / "logs").glob("*.xes")):
        log = pm4py.read_xes(str(log_path))
        for noise in NOISE_THRESHOLDS:
            net, im, fm = pm4py.discover_petri_net_inductive(log, noise_threshold=noise)
            name = f"{log_path.stem}_im_noise{int(noise * 100):02d}.pnml"
            pm4py.write_pnml(net, im, fm, str(out_dir / name))
            print(name)


if __name__ == "__main__":
    main()
