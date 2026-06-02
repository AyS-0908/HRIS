# Simple AI-powered Recruitment Tool for SMB 

## Objective

Provide an HR team with a simple but AI-powered Recruitement workflow, using their day-to-day work tool.

## Tech stack

This is a key question, knowing that:
- Google Sheets = database
- Googel Docs = Job description - including template
- Chatbot = claude.ai - possible use of MCP (existing or to create internally for this use case  HR team)
- (optional if needed) Apps Script, SKILL.md dediecated to Recruitment.

## Workflow

| Step | Tool(s) option | User type/System | Comments |
|---:|---|---|---|
| 1 | Chatbot | Hiring manager / HR requester | User starts a recruitment request. |
| 2 | Chatbot or Google Form | Hiring manager / HR requester | Collect structured answers about the recruitment need. |
| 3 | AI backstage, Google Docs template, Google Drive | System | AI uses the collected answers and a job description template to generate a job description, store it in Google Drive, and provide the document URL to the user. Some source answers are marked unclear in the draft and should be clarified. |
| 4 | Chatbot | Hiring manager / HR requester | Optional sign-off step from the draft: request status such as "validated" or "draft". |
| 5 | AI backstage, Google Sheets, email or Slack-like message | System | Create a tracking row with job description URL, key recruitment information, and status. Notify HR. |
| 6 | Google Sheets | HR team | HR validates the job description and selects where to post or send it. |
| 7 | Workflow automation, AI backstage, job boards/email, Google Form | System | Post or send the job description based on HR selections. Make a candidate application form available. |
| 8 | Google Form, Google Sheets, Google Drive | Candidate / System | Candidate submits the form. Candidate data feeds Google Sheets and CV files are stored in Google Drive. |
| 9 | AI backstage, Google Sheets | System | AI pre-analyzes the CV and recommends one status: Reject, Approve, or Arbitrate. |
| 10 | Google Sheets | HR team | HR validates which candidates should be invited to meet. |
| 11 | AI backstage, HR mailbox, workflow automation | System / HR team | AI prepares customized draft emails for each candidate. HR validates the drafts, then the workflow sends them from an HR mailbox. |
| 12 | AI backstage, HR mailbox, calendar tool | System / HR team | AI scans candidate replies, prepares draft follow-up emails and meeting invitations, and alerts HR. |
| 13 | Google Sheets, calendar tool, workflow automation | System | Once an appointment is approved or rejected, update Google Sheets and confirm the calendar meeting when relevant. |
| 14 | AI backstage, CV, job description | System | For approved appointments, AI prepares application pros and cons based on the CV versus the job description, plus interview questions. |
| 15 | AI backstage, Google Sheets or interview notes | System / HR team | AI reviews interview comments, fact-checks against the job description, and proposes a candidate ranking. |

