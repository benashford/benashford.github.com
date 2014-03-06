---
layout: page
title: Under Construction
tagline: Placeholder
---
{% include JB/setup %}

## Nothing to see here

Placeholding page until something is ready...

## Posts

<ul class="posts">
  {% for post in site.posts %}
    <li><span>{{ post.date | date_to_string }}</span> &raquo; <a href="{{ BASE_PATH }}{{ post.url }}">{{ post.title }}</a></li>
  {% endfor %}
</ul>
