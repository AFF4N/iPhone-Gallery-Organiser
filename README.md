# iPhone Gallery Organiser

A lightweight, high-performance web application to browse, inspect, filter, and organise iPhone media galleries into structured `Year/Month` folders (`YYYY/MM`, `YYYY/MM - MonthName`, or `YYYY`).

Runs entirely locally on your machine with zero cloud dependencies.

---

## Features

- **Blazing Fast Scanning & Previews**:
  - Progressive 360px thumbnail pipeline with Pillow draft downsampling for instantaneous loading of large galleries (thousands of photos).
  - Native HEIC/HEIF photo decoding via `pillow-heif`.
  - Lazy GPU video decoder cleanup to prevent memory exhaustion and browser freezing.
- **Modern ES Module Frontend**:
  - **Instant Sorting**: Sort loaded media in-memory by **Date** (Newest/Oldest), **Size** (Largest/Smallest), **File Type** (A–Z / Z–A), or **Name** (A–Z / Z–A) without re-reading disks.
  - **Auto-Load**: Automatically scans as soon as a source folder is selected or entered.
  - **Corner Badges**: Visual indicators on each gallery tile showing file format (top-right), human-readable file size (bottom-left), and video duration (bottom-right).
  - **Smooth Infinite Scroll**: Chunked 150-item progressive renderer with animated sentinel loading indicator and one-click "Load All" option.
  - **Selection Controls**: Master select/deselect, individual tile checkbox toggle, range selection (`Shift`+click / `Ctrl`+`Shift`+click), and hotkeys (`Ctrl+A`, `Esc`, `Enter`).
- **Interactive Lightbox & Metadata Viewer**:
  - Fullscreen media lightbox with left/right navigation and video playback.
  - Collapsible **Info Drawer** (`i` key) displaying full EXIF, camera, lens, exposure, GPS, and file metadata.
- **Organised Folder Browser (Step 2)**:
  - Collapsible Year/Month folder tree on the left.
  - Live progress tracking during file copy/move operations with clash prevention (`_1`, `_2` suffixes).

---

## Directory Structure

```text
organise_iphone_gallery script/
├── .gitignore
├── README.md
├── organize_photos.py          # Legacy standalone Pillow CLI script
├── organize_photos_exif.py     # Legacy standalone ExifTool CLI script
└── iPhone Gallery Organiser/   # Main Web Application
    ├── gallery_app.py          # Local Python HTTP server & API
    ├── index.html              # Single-page UI
    ├── styles.css              # Dark theme CSS styling
    ├── requirements.txt        # Python dependencies
    ├── README.md               # App documentation
    ├── js/                     # ES6 Modular Frontend
    │   ├── api.js              # Backend API client
    │   ├── app.js              # App bootstrap & view switcher
    │   ├── media.js            # Tiles, lightbox viewer, info drawer, video cleanup
    │   ├── organise-tab.js     # Step 2 folder tree & progress view
    │   └── select-tab.js       # Step 1 selection, sorting, chunked infinite scroll
    └── ExifTool/               # (Git-ignored) Local ExifTool directory
        ├── exiftool.exe
        └── exiftool_files/
```

---

## ExifTool Installation & Setup

[ExifTool](https://exiftool.org) is used by the application to read accurate camera capture dates, video recording timestamps, video durations, and comprehensive EXIF metadata.

Because ExifTool contains platform-specific binaries, it is excluded from Git. Follow these instructions to set it up:

### Windows Setup Instructions:

1. **Download ExifTool**:
   - Go to [exiftool.org](https://exiftool.org) or the official GitHub releases: [github.com/exiftool/exiftool/releases](https://github.com/exiftool/exiftool/releases).
   - Download the **Windows Executable** zip file (e.g. `exiftool-XX.XX_64.zip` or `exiftool-XX.XX.zip`).
2. **Extract the Archive**:
   - Extract the downloaded `.zip` file.
   - You will find `exiftool(-k).exe` and an `exiftool_files` folder (or just `exiftool(-k).exe` in older packages).
3. **Rename the Executable**:
   - Rename `exiftool(-k).exe` to `exiftool.exe` (remove the `(-k)`).
4. **Place in the App Directory**:
   - Inside `iPhone Gallery Organiser/`, create a folder named `ExifTool` if it does not already exist:
     ```text
     iPhone Gallery Organiser/ExifTool/
     ```
   - Move `exiftool.exe` and the `exiftool_files` folder into that folder so the structure is:
     ```text
     iPhone Gallery Organiser/
     └── ExifTool/
         ├── exiftool.exe
         └── exiftool_files/
     ```

> **Note**: If `iPhone Gallery Organiser/ExifTool/exiftool.exe` is not found, the app will check `D:\ExifTool\exiftool.exe` or standard system PATH. If ExifTool is not installed at all, the application continues to function using filesystem modification dates as a fallback.

---

## Python Installation & Setup

1. **Install Python 3.9+**:
   - Ensure Python 3.9 or higher is installed and added to your system `PATH`.
2. **Install Required Packages**:
   Open a terminal in the `iPhone Gallery Organiser` folder and run:
   ```bash
   pip install -r requirements.txt
   ```
   *Dependencies:*
   - `pillow>=10.0` (Fast thumbnail generation and standard photo inspection)
   - `pillow-heif>=0.16` (Direct HEIC/HEIF decoding for iPhone photos)

---

## Running the Application

1. Open a terminal in the `iPhone Gallery Organiser` directory:
   ```bash
   python gallery_app.py
   ```
2. Your default web browser will automatically open:
   ```text
   http://127.0.0.1:8765
   ```
3. To stop the server, press `Ctrl+C` in your terminal.

---

## User Guide

### Step 1: Select & Filter
1. **Choose Source**: Enter or browse for the folder containing your iPhone photos/videos in the **From** field. The application automatically starts scanning immediately.
2. **Sort**: Use the **Sort** dropdown to order files by:
   - **Date**: Newest first *(default)* or Oldest first
   - **Size**: Largest first or Smallest first
   - **Type**: Extension A–Z or Z–A
   - **Name**: Natural alphabetical A–Z or Z–A
3. **Select Files**:
   - Every file begins selected by default.
   - Click the checkmark box on a tile or `Ctrl`+click to toggle exclusion.
   - `Shift`+click selects a continuous range of tiles.
   - Click the master checkbox at the top left to select all or deselect all (`Ctrl+A` / `Esc`).
   - Click any thumbnail image to inspect it in fullscreen lightbox mode.
4. **Target & Organise**: Set your destination in the **To** field and click **Organise**. Choose **Copy** or **Move** and select your desired folder structure:
   - `YYYY/MM` (e.g. `2025/03/IMG_0001.JPG`)
   - `YYYY/MM - MonthName` (e.g. `2025/03 - March/IMG_0001.JPG`)
   - `YYYY` (e.g. `2025/IMG_0001.JPG`)

### Step 2: Organised Gallery & Inspection
- Watch progress live as files are sorted into Year/Month folders.
- Browse the destination folder tree on the left; select any month to view only photos/videos for that period.
- Click any file to open the viewer with the metadata drawer.

---

## Shortcuts Reference

| Shortcut | Action |
|----------|--------|
| `Ctrl + A` | Select all files in import view |
| `Esc` | Deselect all files / Close lightbox |
| `Enter` | Open active tile in viewer |
| `←` / `→` | Previous / Next media in viewer |
| `Space` | Play / Pause video in viewer |
| `i` | Toggle metadata information drawer in viewer |
