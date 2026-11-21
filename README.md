# FairAware teacher website

FairAware monitors live JSON reports from a student program or laboratory coordinator. A single receiver on the teacher PC holds the active exam in process memory. The local dashboard and the signed-in hosted dashboard can both use that receiver. Student reports go directly to the receiver's LAN address.

The teacher prepares a session first so students can connect before the exam timer starts. Selecting Start exam begins the timer without changing the report URL. Preparation events remain available and are marked Before exam.

See lan/START-HERE.txt for setup and the exam lifecycle. The receiver discards all student data when the teacher ends the exam or stops the receiver. The only persistent receiver configuration is its access key. Neither the hosted website nor the local receiver uses a database.

Build the lab download with `node lan/package.mjs`. The output is `public/FairAware-Website.zip`. The hosted frontend is built using the project build command.
