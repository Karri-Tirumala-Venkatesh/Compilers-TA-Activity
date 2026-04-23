from django.urls import path
from . import views

urlpatterns = [
    path('', views.home, name='home'),
    path('api/allocate/', views.api_allocate, name='api_allocate'),
]