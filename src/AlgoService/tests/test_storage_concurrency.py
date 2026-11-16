"""meta.json under concurrent writers and readers: on Windows a replace fails with "Access is denied"
while another writer uses the same temporary file or a reader has the target open. Seen in the
desktop program's end-to-end run (PUT options of a dataset)."""

import threading
import uuid

import pytest

from factor_analysis import storage
import jobs_db


@pytest.fixture
def dataset(tmp_path, monkeypatch):
    monkeypatch.setattr(jobs_db, "ARTIFACTS_DIR", str(tmp_path))
    session = str(uuid.uuid4())
    meta = storage.create(session, kind="model", name="x", source="csv", status="ready", inputs={})
    return session, meta["id"]


def test_concurrent_updates_and_reads_do_not_fail(dataset):
    session, dataset_id = dataset
    errors: list[BaseException] = []
    stop = threading.Event()

    def writer(n: int) -> None:
        try:
            for i in range(40):
                storage.update_meta(session, dataset_id, **{f"w{n}": i})
        except BaseException as exc:  # noqa: BLE001 - every failure counts
            errors.append(exc)

    def reader() -> None:
        try:
            while not stop.is_set():
                assert storage.read_meta(session, dataset_id) is not None
        except BaseException as exc:  # noqa: BLE001
            errors.append(exc)

    readers = [threading.Thread(target=reader) for _ in range(3)]
    writers = [threading.Thread(target=writer, args=(n,)) for n in range(6)]
    for t in readers + writers:
        t.start()
    for t in writers:
        t.join()
    stop.set()
    for t in readers:
        t.join()
    assert errors == []
    meta = storage.read_meta(session, dataset_id)
    assert meta is not None and meta["id"] == dataset_id
    # No temporary file is left behind.
    assert not list(storage.dataset_dir(session, dataset_id).glob("*.tmp"))
