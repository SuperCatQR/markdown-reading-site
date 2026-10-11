"""Export synthetic v2 fixtures with the authoritative producer; never edit exports.

Run with the producer's test environment and Python path. This generator uses
the same isolated historical archive fixture as its description policy tests.
"""
import argparse
from pathlib import Path
import sys
from tempfile import TemporaryDirectory

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("--producer-root", type=Path, required=True)
parser.add_argument("--out", type=Path, required=True)
args = parser.parse_args()
sys.path[:0] = [str(args.producer_root), str(args.producer_root / "src")]

from tests.test_source_supplement import preserved
from tests.test_description_supplement import describe, plan_for
from tests.test_publication import approve
from bili_asr.publication import get_edition, publish_edition
from bili_asr.publication_export import export_publication_drafts, export_publications
from bili_asr.services.source_supplement import apply_source_supplement, plan_source_supplement

with TemporaryDirectory(prefix="reader-description-fixture-") as directory:
    fixture = preserved.__wrapped__(Path(directory))
    connection, archive, editions = next(fixture)
    try:
        describe(connection, [editions[0]])
        description = apply_source_supplement(connection, plan=plan_for(connection, archive, [editions[0]]),
            artifact_roots=(archive,), actor="fixture-operator")
        title_plan = plan_source_supplement(connection, edition_ids=[editions[1]["edition_id"]], artifact_roots=(archive,))
        title = apply_source_supplement(connection, plan=title_plan, artifact_roots=(archive,), actor="fixture-operator")
        edition = get_edition(connection, description["editions"][0]["editionId"])
        approve(connection, edition)
        release = publish_edition(connection, edition_id=edition["edition_id"], artifact_roots=(archive,),
            write_root=archive, actor="fixture-publisher", expected_release_id=edition["current_release_id"])
        export_publications(connection, artifact_roots=(archive,), output=args.out / "content",
            contract_profile="universal-origin-v2", release_ids=[release["release_id"]])
        export_publication_drafts(connection, artifact_roots=(archive,), output=args.out / "draft-content",
            contract_profile="universal-origin-v2", edition_ids=[title["editions"][0]["editionId"]])
    finally:
        fixture.close()
