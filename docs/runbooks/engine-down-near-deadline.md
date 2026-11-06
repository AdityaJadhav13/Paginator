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
2. **Stories, ads and settings:** in the hosted app, download the edition's story bundle ("Send to the Desk",
   `pageinator.story-bundle/2`, PR 24; tools/desk/CONTRACT.md §6) and import it in the Desk ("Pageinator stories…")
   into the edition of the same date. The file carries the Ready stories with their photos, the edition's volume, issue
   and price, and the original artwork of every back-page ad set in the hosted edition (also one still being prepared
   because the engine is down). The Desk:
   - keeps its own version of a story changed in the Desk since an earlier import;
   - fills a volume, issue or price only where the Desk's edition has none, and keeps (and notes) its own where it
     differs: check the notes and correct the edition's settings if the hosted value is right;
   - puts each ad into its empty slot of the same name, fitted as an upload is, and keeps any ad the Desk already has
     there (noted: remove it in the Desk and import again to take the hosted one). An ad whose slot the Desk's page plan
     does not have is not added (noted), and so is every ad while the Desk is making pages: import the file again
     once it has finished. An ad the Desk has that the file does not (cancelled in the hosted app since an earlier
     import) is kept and noted: remove it in the Desk if it should not print;
   - notes a different page count or back-page ads choice, without changing it: change it in the edition's settings
     first if the hosted one is right, then import again.
   If the hosted app refuses to make the file because an ad's picture was rejected, could not be read or was deleted,
   set that slot again, or clear it, in the hosted app and download again (an ad can also be uploaded straight into
   the Desk).
3. **Pages already made:** download the last pages that passed the check (their PDFs and `pdfx-check.txt`), and send
   only those; every other page is made again in the Desk.
4. Lay out and check in the Desk as before L2; the Desk's own press checks decide what may go to press.
5. After the edition: find the cause (worker log in CloudWatch, the queue, the host), fix it, and write down what
   happened. Restart the worker only outside the production window unless the desk asks.

## Not to do

- Do not change the database or delete jobs by hand during the night.
- Do not deploy a fix during the production window unless it is the only way to get the paper out.
