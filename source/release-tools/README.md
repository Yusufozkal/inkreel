# Karevo 3.2.3 public artifact transfer

These tools prepare and attach exactly two public artifacts to the expected **unpublished prerelease draft** in `Yusufozkal/karevo`:

- `Karevo-3.2.3-Setup.exe`
- `Karevo-3.1.3-Android.apk`

No signing keys, keystores, passwords, backup archives or source archives are accepted. The plan contains only public filenames, sizes, hashes and Git blob identifiers. The workflow does not publish the draft, edit a stable release or create a `latest.json` file.

```sh
python test-preview.py
python test-prepare.py
python prepare.py /path/to/Karevo-3.2.3-Setup.exe /path/to/Karevo-3.1.3-Android.apk RELEASE_ID /path/to/new-prepared-directory
python upload-prep.py /path/to/new-prepared-directory
```

`prepare.py` only writes local files. `upload-prep.py` makes public Git blob uploads and commits the draft-only workflow/plan to the current main branch; invoke it only after the actual build artifacts and expected draft identity have been verified. It never dispatches the workflow or publishes a release. Before publication, independently verify both resulting asset sizes and SHA-256 values, then verify the public downloads and that the stable update feed is unchanged. Disable the one-off workflow after use.
