# The engine is down near the deadline

From L2.2 the hosted engine worker lays out pages; in L2.1 there is no hosted engine, and the Desk on the owner's Mac
makes every page. The rule for the night: **the paper goes to press from the Desk**. Never wait for the hosted engine
past the cut-off the desk agreed for the night.

## Signs

- Uptime Kuma or CloudWatch: no worker heartbeat for 60 s, or the oldest waiting job older than 2 minutes between
  18:00 and 02:00 IST (plan §8.4).
- The edition screen shows layout runs waiting or failing.

## Steps (the person on call, **[ALERTS]**)

1. Tell the desk at once: pages come from the Desk tonight.
2. **Stories:** in the hosted app, download the edition's story bundle (`pageinator.story-bundle/1`, PR 24) and import
   it in the Desk ("Pageinator stories…"). Stories changed in the Desk since an earlier import keep the Desk's version.
3. **Pages already made:** download the last pages that passed the check (their PDFs and `pdfx-check.txt`), and send
   only those; every other page is made again in the Desk.
4. Lay out and check in the Desk as before L2; the Desk's own press checks decide what may go to press.
5. After the edition: find the cause (worker log in CloudWatch, the queue, the host), fix it, and write down what
   happened. Restart the worker only outside the production window unless the desk asks.

## Not to do

- Do not change the database or delete jobs by hand during the night.
- Do not deploy a fix during the production window unless it is the only way to get the paper out.
