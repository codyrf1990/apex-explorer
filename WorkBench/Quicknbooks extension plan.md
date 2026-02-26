The Landscape
Apex Explorer owns an uncontested niche. No existing Chrome extension solves QBO PDF renaming. RightTool (42K users, $75/mo) is the dominant QBO extension but doesn't touch filenames. The PDF naming problem has been QBO's #1 document complaint for 7+ years across dozens of Intuit Community threads with zero resolution from Intuit.

Feature Ideas — Ranked by Value + Feasibility
Tier 1: High Impact, Very Feasible
1. More filename tokens from the DOM

{txndate} — actual transaction date (not today), e.g. the invoice date
{amount} / {total} — dollar total
{po} — PO number (huge for B2B workflows)
{status} — Draft/Sent/Paid/Overdue
Problem: Accountants file by date and amount constantly. Current {date} is today's date, not the doc date.
Feasibility: HIGH — these are DOM inputs with aria-label or data-automation-id
2. Download history log

Store every renamed download in chrome.storage.local with num, customer, type, amount, timestamp
Searchable/exportable from the popup or a dedicated page
Problem: "Did I already download invoice 87072?" — no way to know currently
Feasibility: HIGH — just session/local storage writes on each rename

Comment: Ilike the a database storage system ? where you can easily view read and edit pdfs and sign them if you need. 

3. Quick-copy transaction data

One-click copy of transaction number, customer name, or formatted filename to clipboard from popup
Problem: Accountants constantly copy-paste transaction details into emails, spreadsheets, notes
Feasibility: HIGH — read DOM, write to clipboard

I like it

4. Auto-folder routing by type

Save invoices to Downloads/Invoices/, estimates to Downloads/Estimates/, etc.
Or by customer: Downloads/Bison Pumps/
Problem: Users dump everything in Downloads then manually sort
Feasibility: HIGH — suggest() already accepts subdirectory paths
Tier 2: High Impact, Moderate Feasibility

I like this have some defaults and letys the user pick custom locations if needed. 


5. Batch download as individual named PDFs

From QBO's transaction list, select multiple and download each as a separate properly-named PDF
Problem: QBO's "Batch Print" merges everything into one giant PDF. Users report spending 30 minutes to download 100 invoices one at a time. Some need 1000+ PDFs for audits.
Feasibility: MEDIUM — would need to programmatically open each transaction, trigger download, close. Complex but doable with sequenced tab/message orchestration.
This is the single most requested missing feature in QBO forums.

I lie kthis make sure we do heavy research to support perfect implenetastion



6. Transaction date as the actual doc date (not today)

Scrape the date field from the form so {txndate} reflects when the invoice/estimate was created
Problem: Filing by document date is standard accounting practice
Feasibility: MEDIUM — need to verify selectors across all transaction types
Tier 3: Moderate Impact, Feasible

Close date and abble to customize
7. Status badge on extension icon


8. Duplicate filename detection

Warn if a file with the same name already exists in the download folder
Problem: Re-downloading the same invoice creates confusing duplicates
Feasibility: MEDIUM — conflictAction: 'uniquify' already handles this, but a notification would help

Sure this would be nice


11. Batch operations toolbar

Inject a toolbar on QBO list pages for batch select + download/print
Feasibility: LOW-MEDIUM — significant DOM manipulation in a React SPA
What Competitors Charge
RightTool: $75/month per user for batch operations, shortcuts, and QBO enhancements
Dextension: Free extension but requires Dext subscription ($$$)
Xenett: Requires paid subscription for audit/review tools
This suggests there's a real willingness to pay for QBO productivity tools. Even a $5-10/month tier for batch download + advanced tokens would be competitive.

I like this make sure we implement everytrihng we can here correctly. 

My Recommendations — Best Bang for Buck
If I were prioritizing the next features to build:

More tokens ({txndate}, {amount}, {po}) — small effort, big value
Auto-folder routing — trivial to implement, huge workflow improvement
Download history — simple storage, makes the extension stickier
Batch individual PDF download — the killer feature, biggest engineering effort but biggest market demand