from django.urls import path
from . import views

urlpatterns = [
    path("", views.index, name="dashboard"),
    path("capsules/", views.capsule_list, name="capsule_list"),
    path("capsules/create/", views.capsule_create, name="capsule_create"),
    path("capsules/<int:capsule_id>/", views.capsule_detail, name="capsule_detail"),
    path("capsules/<int:capsule_id>/edit/", views.capsule_edit, name="capsule_edit"),
    path("capsules/<int:capsule_id>/delete/", views.capsule_delete, name="capsule_delete"),
    path("capsules/<int:capsule_id>/open/", views.capsule_open, name="capsule_open"),
]
