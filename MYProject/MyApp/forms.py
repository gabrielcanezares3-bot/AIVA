from django import forms
from django.contrib.auth import get_user_model
from django.contrib.auth.forms import UserCreationForm

from .models import TimeCapsule


class RegistrationForm(UserCreationForm):
    email = forms.EmailField(max_length=254)

    class Meta(UserCreationForm.Meta):
        model = get_user_model()
        fields = ("username", "email")


class CapsuleDateFilterForm(forms.Form):
    created_after = forms.DateField(
        required=False,
        label="Created after",
        input_formats=["%Y-%m-%d"],
        widget=forms.DateInput(attrs={"type": "date", "class": "aiva-input"}),
    )
    created_before = forms.DateField(
        required=False,
        label="Created before",
        input_formats=["%Y-%m-%d"],
        widget=forms.DateInput(attrs={"type": "date", "class": "aiva-input"}),
    )

    def clean(self):
        cleaned_data = super().clean()
        created_after = cleaned_data.get("created_after")
        created_before = cleaned_data.get("created_before")
        if created_after and created_before and created_after > created_before:
            raise forms.ValidationError("The start date must be on or before the end date.")
        return cleaned_data


class TimeCapsuleForm(forms.ModelForm):
    class Meta:
        model = TimeCapsule
        fields = ["title", "message", "category", "unlock_date"]
        widgets = {
            "title": forms.TextInput(
                attrs={
                    "placeholder": "e.g. A letter to my future self",
                    "autocomplete": "off",
                }
            ),
            "message": forms.Textarea(
                attrs={
                    "placeholder": "Write something your future self will discover...",
                    "rows": 9,
                }
            ),
            "category": forms.Select(),
            "unlock_date": forms.DateInput(
                format="%Y-%m-%d",
                attrs={"type": "date"},
            ),
        }

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.fields["unlock_date"].input_formats = ["%Y-%m-%d"]

    def clean_title(self):
        title = self.cleaned_data["title"].strip()
        if not title:
            raise forms.ValidationError("Give your time capsule a title.")
        return title

    def clean_message(self):
        message = self.cleaned_data["message"].strip()
        if not message:
            raise forms.ValidationError("Write a message before sealing your capsule.")
        return message
