Project Name: IMPACT7DSC (Daily Student Checklist)

1. Project Overview

A comprehensive web application for academy management, replacing complex Excel sheets.
Focuses on efficiency for teachers using laptops/tablets, featuring bulk actions, automated LMS messaging, and Google Sheets integration.

2. Tech Stack & Style

Framework: React 18+

Styling: Tailwind CSS (Dark Mode default: #09090b background)

Icons: Lucide React

Design Reference: Linear.app, Attio (Compact, Density-focused, High contrast)

Backend: Google Apps Script (Web App Deployment)

3. Data Structure (Core Schema)

Session (Student Task) Object

One student can have multiple sessions in a day (e.g., 15:00 Class, 18:00 Test).

{
  "id": "101",
  "studentId": "st_001",
  "name": "Student Name",
  "class": "Class A",
  "time": "15:00",
  "type": "Regular Class | Test | Clinic", 
  "status": "attendance | late | absent | waiting",
  "backlogCount": 5, // Number of past failed tasks
  "lastEditedBy": "Teacher Name",
  "checks": {
    "basic": { "voca": "none", "idiom": "none", "step3": "none", "isc": "none" },
    "homework": { "reading": "none", "grammar": "none", "practice": "none", "listening": "none", "etc": "none" },
    "review": { "reading": "none", "grammar": "none", "practice": "none", "listening": "none" },
    "nextHomework": { "reading": "", "grammar": "", "practice": "", "listening": "", "extra": "" },
    "memos": { "toDesk": "", "fromDesk": "ReadOnly Message", "toParent": "" },
    "homeworkResult": "none", // Complete, Exempt, SuperPass, Postpone
    "summaryConfirmed": false // Gatekeeper for checkout
  }
}


Check Status Values

none: Not checked (Default, Gray)

o: Pass / Complete (Green)

triangle: Incomplete / Needs Review (Yellow/Amber)

x: Fail / Not Done (Red)

4. Key Features & Business Logic

A. Bulk Actions (Smart Batch Processing)

UI: A floating bar appears when one or more students are selected via checkbox.

Function: Allows setting a specific check item (e.g., 'Homework-Reading') to 'O', '△', or 'X' for all selected students simultaneously.

UX Flow: Select Students -> Click 'Bulk O' -> Apply changes -> Auto-deselect students (Ready for next batch).

B. LMS Message Generation (String Template)

Trigger: 'Copy LMS' button in Detail Panel.

Logic: 1. Start with "[IMPACT7 English] {Name} Report".
2. Include Attendance status.
3. Iterate through checks objects. Skip any key with value 'none'.
4. Convert status: 'o' -> ●, 'triangle' -> ▲, 'x' -> ×.
5. Include 'Next Homework' only if the string is not empty.
6. Append 'Teacher Memo' if exists.
7. End with "Writer: {TeacherName}".

C. Checkout Gatekeeper ( 귀가 관리 )

Condition: Users can only click "Final Checkout" ( 귀가 승인 ) if:

All checked items in basic, homework, review are either 'o' or 'none' (No 'x' or 'triangle').

summaryConfirmed is true.

Action: Sends final data to Google Sheets.

D. Google Sheets Integration (Backend)

API: POST request to Google Apps Script Web App URL.

Dynamic Tab: The Sheet tab name must be the Selected Date (e.g., "2026-02-15").

Payload: Includes full session data + Author Name + Timestamp.

Reliability: Implement Exponential Backoff retry logic (up to 5 times) for unstable networks.

5. UI Components Requirements

Sidebar: Navigation (Timeline, Backlog, Students) + Current User Profile.

Main List (Timeline): - Sort by Time.

Show indicators for Status (Color Badge) and Backlog (Red Alert Icon if > 5).

Compact view of checks (colored dots).

Detail Panel (Slide-over):

Section 1: Result & Checkout (Homework Result Buttons, All-Pass Indicator).

Section 2: Learning Checks (Toggle Buttons for O/△/X).

Section 3: Next Homework (Batch input support).

Section 4: Communication Memos.

Section 5: LMS Preview (Read-only text area).

6. Agents & Roles (For AI Context)

Frontend Agent: Handles React state, UI interactions, and Bulk logic.

Data Agent: Manages JSON structure, ensures none values are handled correctly in LMS generation.

Backend Agent: Manages fetch requests to Google Sheets and error handling.