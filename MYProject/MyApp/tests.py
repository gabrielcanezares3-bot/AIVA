from datetime import datetime, time, timedelta
from io import StringIO

from django.contrib.auth import get_user_model
from django.core.management import call_command, CommandError
from django.db import connection
from django.test import Client, TestCase, TransactionTestCase
from django.urls import reverse
from django.utils import timezone
from django.db.migrations.executor import MigrationExecutor

from .models import TimeCapsule

User = get_user_model()


class CapsuleArchiveDateFilterTests(TestCase):
    def setUp(self):
        self.user = User.objects.create_user(username="archive-user", password="Archive-pass-2026!")
        self.client.force_login(self.user)
        today = timezone.localdate()
        self.older = TimeCapsule.objects.create(
            owner=self.user,
            title="Older memory",
            message="A note from earlier.",
            unlock_date=today + timedelta(days=30),
        )
        self.recent = TimeCapsule.objects.create(
            owner=self.user,
            title="Recent memory",
            message="A note from this week.",
            unlock_date=today + timedelta(days=30),
        )
        TimeCapsule.objects.filter(pk=self.older.pk).update(
            created_date=timezone.make_aware(
                datetime.combine(today - timedelta(days=10), time(12))
            )
        )
        TimeCapsule.objects.filter(pk=self.recent.pk).update(
            created_date=timezone.make_aware(
                datetime.combine(today - timedelta(days=2), time(12))
            )
        )

    def test_created_after_filters_archive_results(self):
        created_after = (timezone.localdate() - timedelta(days=5)).isoformat()

        response = self.client.get(
            reverse("capsule_list"),
            {"created_after": created_after},
        )

        self.assertContains(response, "Recent memory")
        self.assertNotContains(response, "Older memory")

    def test_reversed_created_date_range_is_rejected(self):
        today = timezone.localdate()

        response = self.client.get(
            reverse("capsule_list"),
            {
                "created_after": today.isoformat(),
                "created_before": (today - timedelta(days=1)).isoformat(),
            },
        )

        self.assertContains(response, "The start date must be on or before the end date.")
        self.assertContains(response, "Older memory")
        self.assertContains(response, "Recent memory")

    def test_search_category_status_and_date_filters_can_be_combined(self):
        created_after = (timezone.localdate() - timedelta(days=5)).isoformat()

        response = self.client.get(
            reverse("capsule_list"),
            {
                "q": "memory",
                "category": "Personal",
                "status": "Sealed",
                "created_after": created_after,
            },
        )

        self.assertContains(response, "Recent memory")
        self.assertNotContains(response, "Older memory")


class AuthenticationTests(TestCase):
    def test_registration_creates_user_with_hashed_password(self):
        response = self.client.post(
            reverse("register"),
            {
                "username": "future-writer",
                "email": "writer@example.com",
                "password1": "AIVA-private-letter-2026!",
                "password2": "AIVA-private-letter-2026!",
            },
        )

        self.assertRedirects(response, reverse("login"))
        user = User.objects.get(username="future-writer")
        self.assertEqual(user.email, "writer@example.com")
        self.assertNotEqual(user.password, "AIVA-private-letter-2026!")
        self.assertTrue(user.check_password("AIVA-private-letter-2026!"))

    def test_registration_rejects_duplicate_username_invalid_email_weak_and_mismatched_passwords(self):
        User.objects.create_user(username="already-here", password="Valid-secret-2026!")
        invalid_registrations = [
            {
                "username": "already-here",
                "email": "duplicate@example.com",
                "password1": "AIVA-private-letter-2026!",
                "password2": "AIVA-private-letter-2026!",
            },
            {
                "username": "invalid-email-user",
                "email": "not-an-email",
                "password1": "AIVA-private-letter-2026!",
                "password2": "AIVA-private-letter-2026!",
            },
            {
                "username": "weak-password-user",
                "email": "weak@example.com",
                "password1": "short",
                "password2": "short",
            },
            {
                "username": "mismatched-password-user",
                "email": "mismatch@example.com",
                "password1": "AIVA-private-letter-2026!",
                "password2": "Different-secret-2026!",
            },
        ]

        for data in invalid_registrations:
            with self.subTest(username=data["username"]):
                response = self.client.post(reverse("register"), data)
                self.assertEqual(response.status_code, 200)
                self.assertTrue(response.context["form"].errors)
                self.assertContains(response, "Please correct the errors below")
                if data["username"] == "already-here":
                    self.assertEqual(User.objects.filter(username=data["username"]).count(), 1)
                else:
                    self.assertFalse(User.objects.filter(username=data["username"]).exists())

    def test_login_accepts_valid_credentials_and_rejects_invalid_credentials(self):
        User.objects.create_user(username="login-user", password="Login-secret-2026!")

        invalid_response = self.client.post(
            reverse("login"),
            {"username": "login-user", "password": "incorrect"},
        )
        self.assertEqual(invalid_response.status_code, 200)
        self.assertContains(invalid_response, "Please check your username and password")
        self.assertNotIn("_auth_user_id", self.client.session)

        valid_response = self.client.post(
            reverse("login"),
            {"username": "login-user", "password": "Login-secret-2026!"},
        )
        self.assertRedirects(valid_response, reverse("dashboard"))
        self.assertEqual(
            int(self.client.session["_auth_user_id"]),
            User.objects.get(username="login-user").pk,
        )

    def test_authenticated_users_are_redirected_from_login_and_registration(self):
        user = User.objects.create_user(username="signed-in", password="Login-secret-2026!")
        self.client.force_login(user)

        self.assertRedirects(self.client.get(reverse("login")), reverse("dashboard"))
        self.assertRedirects(self.client.get(reverse("register")), reverse("dashboard"))

    def test_logout_is_post_only_and_clears_session(self):
        user = User.objects.create_user(username="logout-user", password="Login-secret-2026!")
        self.client.force_login(user)

        response = self.client.post(reverse("logout"))

        self.assertRedirects(response, reverse("login"))
        self.assertNotIn("_auth_user_id", self.client.session)
        self.assertEqual(self.client.get(reverse("logout")).status_code, 405)

    def test_logout_requires_csrf(self):
        user = User.objects.create_user(username="csrf-logout-user", password="Login-secret-2026!")
        csrf_client = Client(enforce_csrf_checks=True)
        csrf_client.force_login(user)

        response = csrf_client.post(reverse("logout"))

        self.assertEqual(response.status_code, 403)


class CapsuleAccessTests(TestCase):
    def setUp(self):
        self.owner = User.objects.create_user(username="capsule-owner", password="Owner-secret-2026!")
        self.other_user = User.objects.create_user(
            username="other-owner",
            password="Other-secret-2026!",
        )
        self.today = timezone.localdate()
        self.owned_capsule = TimeCapsule.objects.create(
            owner=self.owner,
            title="My private note",
            message="Only my account should see this.",
            unlock_date=self.today + timedelta(days=3),
        )
        self.other_capsule = TimeCapsule.objects.create(
            owner=self.other_user,
            title="Another person's note",
            message="This belongs to another account.",
            unlock_date=self.today,
        )
        self.unowned_capsule = TimeCapsule.objects.create(
            title="Unassigned legacy note",
            message="This has not been assigned to an account.",
            unlock_date=self.today,
        )

    def test_all_capsule_routes_redirect_anonymous_users_to_login(self):
        routes = [
            reverse("dashboard"),
            reverse("capsule_list"),
            reverse("capsule_create"),
            reverse("capsule_detail", args=[self.owned_capsule.pk]),
            reverse("capsule_edit", args=[self.owned_capsule.pk]),
            reverse("capsule_delete", args=[self.owned_capsule.pk]),
            reverse("capsule_open", args=[self.owned_capsule.pk]),
        ]

        for url in routes:
            with self.subTest(url=url):
                response = self.client.get(url)
                self.assertRedirects(
                    response,
                    f"{reverse('login')}?next={url}",
                    fetch_redirect_response=False,
                )

    def test_dashboard_statistics_and_capsule_list_only_include_current_user(self):
        self.client.force_login(self.owner)

        dashboard = self.client.get(reverse("dashboard"))
        archive = self.client.get(reverse("capsule_list"))

        self.assertEqual(dashboard.context["total_count"], 1)
        self.assertEqual(dashboard.context["sealed_count"], 1)
        self.assertEqual(dashboard.context["opened_count"], 0)
        self.assertEqual([item.pk for item in dashboard.context["recent_capsules"]], [self.owned_capsule.pk])
        self.assertContains(archive, "My private note")
        self.assertNotContains(archive, "Another person's note")
        self.assertNotContains(archive, "Unassigned legacy note")

    def test_unassigned_legacy_capsules_cannot_be_viewed_or_modified(self):
        self.client.force_login(self.owner)
        detail_url = reverse("capsule_detail", args=[self.unowned_capsule.pk])
        edit_url = reverse("capsule_edit", args=[self.unowned_capsule.pk])
        delete_url = reverse("capsule_delete", args=[self.unowned_capsule.pk])
        open_url = reverse("capsule_open", args=[self.unowned_capsule.pk])

        self.assertEqual(self.client.get(detail_url).status_code, 404)
        self.assertEqual(self.client.get(edit_url).status_code, 404)
        self.assertEqual(self.client.get(delete_url).status_code, 404)
        self.assertEqual(self.client.post(delete_url).status_code, 404)
        self.assertEqual(self.client.post(open_url).status_code, 404)

        self.unowned_capsule.refresh_from_db()
        self.assertIsNone(self.unowned_capsule.owner)
        self.assertEqual(self.unowned_capsule.status, "Sealed")
        self.assertTrue(TimeCapsule.objects.filter(pk=self.unowned_capsule.pk).exists())

    def test_foreign_capsule_detail_edit_delete_and_open_are_not_accessible(self):
        self.client.force_login(self.owner)
        detail_url = reverse("capsule_detail", args=[self.other_capsule.pk])
        edit_url = reverse("capsule_edit", args=[self.other_capsule.pk])
        delete_url = reverse("capsule_delete", args=[self.other_capsule.pk])
        open_url = reverse("capsule_open", args=[self.other_capsule.pk])

        self.assertEqual(self.client.get(detail_url).status_code, 404)
        self.assertEqual(self.client.get(edit_url).status_code, 404)
        self.assertEqual(
            self.client.post(
                edit_url,
                {
                    "title": "Changed by another user",
                    "message": "This should not save.",
                    "category": "Personal",
                    "unlock_date": (self.today + timedelta(days=5)).isoformat(),
                },
            ).status_code,
            404,
        )
        self.assertEqual(self.client.get(delete_url).status_code, 404)
        self.assertEqual(self.client.post(delete_url).status_code, 404)
        self.assertEqual(self.client.post(open_url).status_code, 404)

        self.other_capsule.refresh_from_db()
        self.assertEqual(self.other_capsule.title, "Another person's note")
        self.assertEqual(self.other_capsule.status, "Sealed")
        self.assertTrue(TimeCapsule.objects.filter(pk=self.other_capsule.pk).exists())

    def test_capsule_creation_editing_and_unlock_rules_remain_available(self):
        self.client.force_login(self.owner)
        create_response = self.client.post(
            reverse("capsule_create"),
            {
                "title": "New letter",
                "message": "A letter for my future self.",
                "category": "Letters",
                "unlock_date": (self.today + timedelta(days=2)).isoformat(),
            },
        )
        self.assertEqual(create_response.status_code, 302)
        capsule = TimeCapsule.objects.get(title="New letter")
        self.assertEqual(capsule.owner, self.owner)

        edit_response = self.client.post(
            reverse("capsule_edit", args=[capsule.pk]),
            {
                "title": "Updated letter",
                "message": "The edited letter.",
                "category": "Letters",
                "unlock_date": (self.today + timedelta(days=2)).isoformat(),
            },
        )
        self.assertRedirects(
            edit_response,
            reverse("capsule_detail", args=[capsule.pk]),
        )
        capsule.refresh_from_db()
        self.assertEqual(capsule.title, "Updated letter")

        open_url = reverse("capsule_open", args=[capsule.pk])
        locked_response = self.client.post(open_url)
        self.assertRedirects(locked_response, reverse("capsule_detail", args=[capsule.pk]))
        capsule.refresh_from_db()
        self.assertEqual(capsule.status, "Sealed")

        TimeCapsule.objects.filter(pk=capsule.pk).update(unlock_date=self.today)
        self.client.post(open_url)
        capsule.refresh_from_db()
        self.assertEqual(capsule.status, "Opened")

    def test_invalid_unlock_date_is_rejected_and_owner_can_delete_capsule(self):
        self.client.force_login(self.owner)
        invalid_response = self.client.post(
            reverse("capsule_create"),
            {
                "title": "Invalid date",
                "message": "This should not be saved.",
                "category": "Personal",
                "unlock_date": "not-a-date",
            },
        )
        self.assertEqual(invalid_response.status_code, 200)
        self.assertIn("unlock_date", invalid_response.context["form"].errors)
        self.assertFalse(TimeCapsule.objects.filter(title="Invalid date").exists())

        delete_response = self.client.post(
            reverse("capsule_delete", args=[self.owned_capsule.pk])
        )
        self.assertRedirects(delete_response, reverse("capsule_list"))
        self.assertFalse(TimeCapsule.objects.filter(pk=self.owned_capsule.pk).exists())

    def test_open_requires_csrf_and_get_does_not_open(self):
        csrf_client = Client(enforce_csrf_checks=True)
        csrf_client.force_login(self.owner)
        open_url = reverse("capsule_open", args=[self.owned_capsule.pk])

        self.assertEqual(csrf_client.get(open_url).status_code, 405)
        self.assertEqual(csrf_client.post(open_url).status_code, 403)
        self.owned_capsule.refresh_from_db()
        self.assertEqual(self.owned_capsule.status, "Sealed")


class LegacyCapsuleAssignmentCommandTests(TestCase):
    def test_command_assigns_only_unowned_capsules(self):
        user = User.objects.create_user(username="legacy-owner", password="Legacy-secret-2026!")
        other_user = User.objects.create_user(username="existing-owner", password="Existing-secret-2026!")
        legacy = TimeCapsule.objects.create(
            title="Unassigned legacy note",
            message="This record must be explicitly assigned.",
            unlock_date=timezone.localdate() + timedelta(days=10),
        )
        already_owned = TimeCapsule.objects.create(
            owner=other_user,
            title="Already assigned note",
            message="This owner must not be overwritten.",
            unlock_date=timezone.localdate() + timedelta(days=10),
        )
        output = StringIO()

        call_command("assign_legacy_capsules", "legacy-owner", stdout=output)

        legacy.refresh_from_db()
        already_owned.refresh_from_db()
        self.assertEqual(legacy.owner, user)
        self.assertEqual(already_owned.owner, other_user)
        self.assertIn("Assigned 1 unowned time capsule(s)", output.getvalue())

    def test_command_rejects_unknown_username_without_assigning_records(self):
        legacy = TimeCapsule.objects.create(
            title="Still unassigned",
            message="No arbitrary account should receive this.",
            unlock_date=timezone.localdate() + timedelta(days=10),
        )

        with self.assertRaises(CommandError):
            call_command("assign_legacy_capsules", "missing-user")

        legacy.refresh_from_db()
        self.assertIsNone(legacy.owner)


class CapsuleOwnershipMigrationTests(TransactionTestCase):
    migrate_from = [("MyApp", "0001_initial")]
    migrate_to = [("MyApp", "0002_timecapsule_owner")]

    def setUp(self):
        super().setUp()
        executor = MigrationExecutor(connection)
        executor.migrate(self.migrate_from)
        old_apps = executor.loader.project_state(self.migrate_from).apps
        old_capsule_model = old_apps.get_model("MyApp", "TimeCapsule")

        self.expected_created = timezone.make_aware(datetime(2026, 1, 2, 12, 30))
        capsule = old_capsule_model.objects.create(
            title="Preserve this legacy capsule",
            message="Keep every field while ownership is added.",
            category="Letters",
            unlock_date=datetime(2027, 4, 5).date(),
            status="Opened",
        )
        old_capsule_model.objects.filter(pk=capsule.pk).update(
            created_date=self.expected_created
        )
        self.capsule_id = capsule.pk

        MigrationExecutor(connection).migrate(self.migrate_to)

    def tearDown(self):
        executor = MigrationExecutor(connection)
        executor.migrate(executor.loader.graph.leaf_nodes())
        super().tearDown()

    def test_nullable_owner_migration_preserves_legacy_capsule_fields(self):
        capsule = TimeCapsule.objects.get(pk=self.capsule_id)

        self.assertIsNone(capsule.owner)
        self.assertEqual(capsule.capsule_id, self.capsule_id)
        self.assertEqual(capsule.title, "Preserve this legacy capsule")
        self.assertEqual(capsule.message, "Keep every field while ownership is added.")
        self.assertEqual(capsule.category, "Letters")
        self.assertEqual(capsule.created_date, self.expected_created)
        self.assertEqual(capsule.unlock_date.isoformat(), "2027-04-05")
        self.assertEqual(capsule.status, "Opened")
