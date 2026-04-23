from django.urls import path
from . import views

urlpatterns = [
    path('', views.home, name='home'),
    path('api/allocate/', views.api_allocate, name='api_allocate'),
    path('api/parse_tac/', views.api_parse_tac, name='api_parse_tac'),
]