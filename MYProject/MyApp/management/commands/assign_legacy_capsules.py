from django.contrib.auth import get_user_model
from django.core.management.base import BaseCommand, CommandError
from django.db import transaction

from MyApp.models import TimeCapsule


class Command(BaseCommand):
    help = "Assign unowned legacy time capsules to an existing username."

    def add_arguments(self, parser):
        parser.add_argument("username", help="Existing account that will own unassigned capsules.")

    def handle(self, *args, username, **options):
        user_model = get_user_model()
        with transaction.atomic():
            try:
                user = user_model._default_manager.get(username=username)
            except user_model.DoesNotExist as exc:
                raise CommandError(f"No account exists with username {username!r}.") from exc

            assigned_count = TimeCapsule.objects.filter(owner__isnull=True).update(
                owner=user
            )

        self.stdout.write(
            self.style.SUCCESS(
                f"Assigned {assigned_count} unowned time capsule(s) to {user.username}."
            )
        )
