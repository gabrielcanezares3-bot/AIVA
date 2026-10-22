from django.contrib import messages
from django.contrib.auth import logout
from django.contrib.auth.decorators import login_required
from django.contrib.auth.views import LoginView
from django.db.models import Q
from django.shortcuts import get_object_or_404, redirect, render
from django.views.decorators.http import require_POST
from django.utils import timezone

from .forms import CapsuleDateFilterForm, RegistrationForm, TimeCapsuleForm
from .models import TimeCapsule


class AIVALoginView(LoginView):
    template_name = "ims_app/login.html"
    redirect_authenticated_user = True

    def form_valid(self, form):
        messages.success(self.request, "Welcome back to AIVA.")
        return super().form_valid(form)

    def form_invalid(self, form):
        messages.error(self.request, "Please check your username and password and try again.")
        return super().form_invalid(form)


def register(request):
    if request.user.is_authenticated:
        return redirect("dashboard")

    if request.method == "POST":
        form = RegistrationForm(request.POST)
        if form.is_valid():
            form.save()
            messages.success(request, "Your AIVA account has been created. Please sign in.")
            return redirect("login")
        messages.error(request, "Please correct the errors below and try again.")
    else:
        form = RegistrationForm()

    return render(request, "ims_app/register.html", {"form": form})


@require_POST
def logout_view(request):
    was_authenticated = request.user.is_authenticated
    logout(request)
    if was_authenticated:
        messages.success(request, "You have been signed out.")
    return redirect("login")


@login_required
def index(request):
    today = timezone.localdate()
    capsules = request.user.time_capsules.all().order_by("-created_date")

    context = {
        "total_count": capsules.count(),
        "sealed_count": capsules.filter(status="Sealed").count(),
        "opened_count": capsules.filter(status="Opened").count(),
        "upcoming_count": capsules.filter(status="Sealed", unlock_date__gt=today).count(),
        "recent_capsules": capsules[:6],
        "upcoming_capsules": capsules.filter(
            status="Sealed", unlock_date__gte=today
        ).order_by("unlock_date")[:4],
        "today": today,
    }
    return render(request, "ims_app/django.html", context)


@login_required
def capsule_list(request):
    capsules = request.user.time_capsules.all().order_by("-created_date")
    date_filter_form = CapsuleDateFilterForm(request.GET)

    query = request.GET.get("q", "").strip()
    category = request.GET.get("category", "").strip()
    status = request.GET.get("status", "").strip()

    if query:
        capsules = capsules.filter(
            Q(title__icontains=query) | Q(message__icontains=query)
        )
    if category:
        capsules = capsules.filter(category=category)
    if status:
        capsules = capsules.filter(status=status)
    if date_filter_form.is_valid():
        created_after = date_filter_form.cleaned_data["created_after"]
        created_before = date_filter_form.cleaned_data["created_before"]
        if created_after:
            capsules = capsules.filter(created_date__date__gte=created_after)
        if created_before:
            capsules = capsules.filter(created_date__date__lte=created_before)

    context = {
        "capsules": capsules,
        "query": query,
        "selected_category": category,
        "selected_status": status,
        "categories": TimeCapsule.CATEGORY_CHOICES,
        "statuses": TimeCapsule.STATUS_CHOICES,
        "date_filter_form": date_filter_form,
    }
    return render(request, "ims_app/capsules.html", context)


@login_required
def capsule_create(request):
    if request.method == "POST":
        form = TimeCapsuleForm(request.POST)
        if form.is_valid():
            capsule = form.save(commit=False)
            capsule.owner = request.user
            capsule.save()
            messages.success(
                request,
                f'"{capsule.title}" has been sealed into your time capsule.',
            )
            return redirect("capsule_detail", capsule_id=capsule.capsule_id)
    else:
        form = TimeCapsuleForm()

    return render(
        request,
        "ims_app/capsule_form.html",
        {"form": form, "page_title": "Create Time Capsule", "is_edit": False},
    )


@login_required
def capsule_detail(request, capsule_id):
    capsule = get_object_or_404(request.user.time_capsules, capsule_id=capsule_id)
    return render(
        request,
        "ims_app/capsule_detail.html",
        {
            "capsule": capsule,
            "can_open": capsule.is_ready_to_open,
        },
    )


@login_required
def capsule_edit(request, capsule_id):
    capsule = get_object_or_404(request.user.time_capsules, capsule_id=capsule_id)

    if request.method == "POST":
        form = TimeCapsuleForm(request.POST, instance=capsule)
        if form.is_valid():
            form.save()
            messages.success(request, "Your time capsule was updated.")
            return redirect("capsule_detail", capsule_id=capsule.capsule_id)
    else:
        form = TimeCapsuleForm(instance=capsule)

    return render(
        request,
        "ims_app/capsule_form.html",
        {"form": form, "page_title": "Edit Time Capsule", "is_edit": True, "capsule": capsule},
    )


@login_required
def capsule_delete(request, capsule_id):
    capsule = get_object_or_404(request.user.time_capsules, capsule_id=capsule_id)

    if request.method == "POST":
        title = capsule.title
        capsule.delete()
        messages.success(request, f'"{title}" was deleted.')
        return redirect("capsule_list")

    return render(
        request,
        "ims_app/capsule_confirm_delete.html",
        {"capsule": capsule},
    )


@login_required
@require_POST
def capsule_open(request, capsule_id):
    capsule = get_object_or_404(request.user.time_capsules, capsule_id=capsule_id)

    if capsule.status == "Opened":
        return redirect("capsule_detail", capsule_id=capsule_id)

    if capsule.unlock_date <= timezone.localdate():
        capsule.status = "Opened"
        capsule.save(update_fields=["status"])
        messages.success(request, "Your time capsule has been opened. Welcome back, future you.")
    else:
        messages.error(
            request,
            f"This capsule is still sealed. It unlocks on {capsule.unlock_date:%B %d, %Y}.",
        )

    return redirect("capsule_detail", capsule_id=capsule_id)
