# Producer Export Fixture

The two snapshot directories were exported by the producer implementation of
`preserved-body-import-v1`, based on producer main `472229804283655e877a3dd01764e4991a807cc9`.
The draft snapshot is the direct output of `test_native_and_imported_drafts_share_exact_profile`
in `tests/test_preserved_body_import.py`, including a synthetic native YouTube
revision, a preserved historical Bilibili body and a subsequent human edit.
The public snapshot is an explicitly empty profile export. These are synthetic
contract fixtures, not production manuscripts. Keep their original bytes and
cross-file hashes together when regenerating them.

`published-example` is the direct public export from
`test_new_profile_and_snapshot_restore_closed_loop`: an imported edition approved
and explicitly published with publish-v2 while its AI reference retains ai-draft-v1.
