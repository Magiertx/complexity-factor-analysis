"""Make prom4py-cleaned.zip: the Zenodo prom4py.zip without the parts XCom leaves out.

Same list as scripts/desktop_prom.py on the branch desktop-prom: the proprietary Java APIs of
Gurobi and IBM CPLEX (not ours to pass on), the build trees of OpenXES and UITopia (their jars
are in ivy/ as well) and the test tools of five packages. Entries are copied byte for byte with
their dates, so the result is the same on every run.
"""
import hashlib
import re
import sys
import zipfile

SRC, DST = sys.argv[1], sys.argv[2]
DROP = [
    r"ProM4Py/OpenXES/",
    r"ProM4Py/UITopia/",
    r"ProM4Py/Packages/[^/]+/Trunk/tests/",
    r"ProM4Py/Packages/ProM-Contexts/Trunk/ivy/gurobi-6\.5\.jar",
    r"ProM4Py/Packages/ProM-Contexts/Trunk/ivy/oplall-6\.3\.jar",
]
pattern = re.compile("|".join(f"(?:{d})" for d in DROP))

kept = dropped = 0
with zipfile.ZipFile(SRC) as zin, zipfile.ZipFile(DST, "w", zipfile.ZIP_DEFLATED, compresslevel=9) as zout:
    for info in zin.infolist():
        if pattern.match(info.filename):
            dropped += 1
            continue
        data = zin.read(info)
        out = zipfile.ZipInfo(info.filename, date_time=info.date_time)
        out.external_attr = info.external_attr
        out.compress_type = zipfile.ZIP_STORED if info.is_dir() else zipfile.ZIP_DEFLATED
        zout.writestr(out, data)
        kept += 1

h = hashlib.sha256()
with open(DST, "rb") as f:
    for chunk in iter(lambda: f.read(1 << 20), b""):
        h.update(chunk)
print(f"kept {kept}, dropped {dropped}")
print(f"sha256 {h.hexdigest()}")
with zipfile.ZipFile(DST) as z:
    names = z.namelist()
    assert not any("gurobi" in n or "oplall" in n for n in names), "proprietary jar left"
    assert any(n.startswith("ProM4Py/Packages/Workshop/Trunk/out/production/prom/") for n in names)
print("check ok")
