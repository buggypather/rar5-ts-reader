# Test archives from libarchive

These RAR 5 files come from libarchive's test suite
(https://github.com/libarchive/libarchive, `libarchive/test/test_read_format_rar5_*.rar.uu`),
decoded from uuencode and renamed without the `test_read_format_rar5_` prefix. They're used here
unchanged, under libarchive's licence (see COPYING in this folder).

Many of them are deliberately broken (found by fuzzing); the tests check that those give a
`Rar5Error` instead of crashing or hanging.
