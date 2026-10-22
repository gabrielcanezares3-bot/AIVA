from django.conf import settings
from django.db import models
from django.utils import timezone


class TimeCapsule(models.Model):
    CATEGORY_CHOICES = [
        ("Memories", "Memories"),
        ("Goals", "Goals"),
        ("Letters", "Letters"),
        ("Dreams", "Dreams"),
        ("Achievements", "Achievements"),
        ("Personal", "Personal"),
    ]

    STATUS_CHOICES = [
        ("Sealed", "Sealed"),
        ("Opened", "Opened"),
    ]

    capsule_id = models.AutoField(primary_key=True)
    owner = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        related_name="time_capsules",
        null=True,
        blank=True,
    )
    title = models.CharField(max_length=150)
    message = models.TextField()
    category = models.CharField(
        max_length=50,
        choices=CATEGORY_CHOICES,
        default="Personal",
    )
    created_date = models.DateTimeField(auto_now_add=True)
    unlock_date = models.DateField()
    status = models.CharField(
        max_length=20,
        choices=STATUS_CHOICES,
        default="Sealed",
    )

    @property
    def is_ready_to_open(self):
        return self.status != "Opened" and self.unlock_date <= timezone.localdate()

    @property
    def days_until_unlock(self):
        if self.status == "Opened":
            return 0
        return max((self.unlock_date - timezone.localdate()).days, 0)

    def __str__(self):
        return self.title
