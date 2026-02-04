# Analysis

The purpose of this analysis is to see the user's re-reading and revision behaviour when writing an essay. Re-reading is measured through eye fixation time on corresponding blocks. For example when writingMode is "block", the eye fixation time on the TextEditor area v.s. DevelopedTextPanel allows us to infer the user's cognitive process through re-reading behaviours while writing. We use the [pymovements library](https://github.com/pymovements/pymovements) to detect fixation from the raw gaze data. Revision is measured through # of added/removed words in each mode, as well as the # of reordering that happens for "block" writing mode.

# About the data
**sample-gaze.json**: this includes the eye gaze position of the users, in 60Hz. Top left of the screen is (0,0), bottom right is (1,1). NaN is given when the gaze was outside of the screen or untracked. The positions are sometimes outside of 0-1, which also means it was outside of the screen. Each line is in JSON format, but the entire file is missing the wrapper brackets, as well as commas for each line.

**sample-aoi.json**: this includes 3 types of logs, as shown in the "type" property. All coordinates are in pixels, and the full width/height of the screen is provided in the "window" property of each entry. First type is **AOI (Area of Interest)**, which logs the positions of key UI components. The number of key UI components tracked is different depending on writingMode: "block" has 4 components (TopicInput, WritingBlock, TextEditor, DevelopedTextPanel), "ai-only" has 2 components (TopicInput, DevelopedTextPanel), and "manual" has 1 component (ManualTextarea). These are logged either on initial capture on start, window resize, scroll,layout change (due to expanding panel, content changes), mode change or heartbeat (every 500ms). Second type is **TEXT_DIFF**, which logs the number of added/removed words when a user has been typing but paused for 800ms. This comes with other properties like writingMode, editType (e.g. new-dropped, edit-existing, regenerate-new, etc.), location (UI component name), and blockId/indexId if the location is TextEditor. Third type is **BLOCK_REORDER**, which is logged when writingMode is "block" and the user reorders the blocks. It also comes with properties like blockIds and moveType.

# Troubleshooting
- If you are using `pyenv` like I am, then `import pymovements` may lead to the `No module named '_lzma'` error. If you do, just run
```
$  brew install xz
$  pyenv uninstall <desired-python-version>
$  pyenv install <desired-python-version>
```

- `pip install tobii_research` is no longer available. Go to [Tobii's SDK download page](https://connect.tobii.com/s/sdk-downloads?language=en_US), download the Python SDK, and manually place it where your pip packages are installed. Macs wouldn't like you to use manually installed packages, so on your first run you have to go to System Settings => Privacy & Security => Security and click "Allow Anyway" for all Tobii related warnings.