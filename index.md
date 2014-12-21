---
layout: page
title: Index
tagline: 
---
{% include JB/setup %}

## Welcome

Just a few articles on things I have found interesting.

## Posts

<ul class="posts">
  {% for post in site.posts %}
    <li><span>{{ post.date | date_to_string }}</span> &raquo; <a href="{{ BASE_PATH }}{{ post.url }}">{{ post.title }}</a></li>
  {% endfor %}
</ul>
