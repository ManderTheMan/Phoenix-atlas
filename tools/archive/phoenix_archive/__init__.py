"""Phoenix Atlas archive tool.

Goes through years of videos on your own computer (folders and Google Takeout
zips), finds the ones with someone training in them, and tracks the joints with
the same pose model the app uses. The output is small: joint tracks, a small
copy of each usable clip and an index, ready to import into Phoenix Atlas.
Nothing is uploaded anywhere.
"""

VERSION = "1.1.0"
