from django.contrib import admin
from .models import TimeCapsule


@admin.register(TimeCapsule)
class TimeCapsuleAdmin(admin.ModelAdmin):
    list_display = ("capsule_id", "title", "owner", "category", "created_date", "unlock_date", "status")
    list_filter = ("owner", "category", "status")
    search_fields = ("title", "message", "owner__username")
    ordering = ("-created_date",)
