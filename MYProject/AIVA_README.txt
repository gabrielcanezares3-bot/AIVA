AIVA — Digital Time Capsule
===========================

Run from this folder (the folder containing manage.py):

    python manage.py check
    python manage.py migrate
    python manage.py runserver

Main pages:
    /
    /capsules/
    /capsules/create/
    /capsules/<id>/
    /capsules/<id>/edit/
    /capsules/<id>/delete/

No external frontend packages are required.

Workflow:
    CREATE -> SEAL -> WAIT -> OPEN

Account and legacy capsule ownership setup:
    1. From this folder, apply the ownership migration:
           python manage.py migrate
    2. Register your account in AIVA (or sign in to the account you already use).
    3. Assign unowned legacy capsules only to your chosen username:
           python manage.py assign_legacy_capsules YOUR_USERNAME
       The command reports how many records it assigned, and does not change
       capsules that already have an owner.
    4. Sign in as that username and verify the assigned capsules in the Archive.
       The assignment command can also be rerun safely; already-owned records
       are never reassigned.

The ownership migration adds a nullable owner field, preserving existing capsule
IDs, dates, messages, categories, and statuses. Legacy capsules remain private
from application views until they are explicitly assigned.
