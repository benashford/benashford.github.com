---
layout: post
title: "Rust traits for developer friendly libraries"
description: ""
category: "blog"
tags: rust
---
{% include JB/setup %}

For the last six months or so, I've been looking more-and-more into [Rust](/blog/2014/12/21/rust/), and the more I look into it the more I like.

My latest Rust project has been to implement a [client to the ElasticSearch REST API](https://github.com/benashford/rs-es).  I have implemented such things before, in different programming languages[^1], and recently came on an excuse to write one in Rust; the need to have such thing has long since passed but the process of writing it has been a good opportunity to delve more into Rust, and think about how to implement such things.

### The ElasticSearch API ###

The ElasticSearch API on it's surface is deceptively simple.  It appears there is a simple convention in its URLs: `/index/type/id`, a RESTful convention for HTTP methods.  The documents it indexes and returns are JSON documents which can be easily embedded in the JSON payloads that are submitted when searching and returned from various operations.  And indeed, from many dynamic languages it is easy; that's because those languages, on account of being dynamic and having simple literal syntax for maps, these arbitrary chunks of JSON can be embedded and manipulated without much headache.

The first challenge, therefore, was to break away from that kind of thinking.  Since Rust is not a dynamic language, and since it's design is very much aimed at systems programming, building an ElasticSearch client in Rust the same way I would in Clojure or Ruby would be both painful, and not taking advantage of Rust's strengths.

The cost of this has been the size of the library.  It is already significantly bigger than previous ElasticSearch clients, and I've only started implementing it; there are many large areas so far untouched (e.g. aggregations).  But the benefit is type-safety and hopefully self-explanatory code.  By using enums to specifically list all legitimate values of a parameter, for instance, many invalid combinations will be discovered at compile time.

### The query DSL ###

Many of the API end-points are relatively simple: a struct with a few optional values.  The single biggest area of complication has been the [Query DSL](https://www.elastic.co/guide/en/elasticsearch/reference/current/query-dsl.html); this consists of several dozen filters and queries, each of which with overlapping sets of slightly inconsistent options, many of which then go on to contain other filters and queries nested underneath.

The first challenge was how to write all the structs and enums and builder-functions necessary to capture all of this.  That problem I solved by generating the majority of the code.  I might write more about this in a future blog post because the current implementation is a bit gnarly, I intend to refactor it now it's mostly finished and I have the benefit of hindsight.

The second challenge is theoretically smaller, but also slightly trickier.  This challenge is how to structure the Rust implementation so that users of my library can use this code without friction, and maybe even enjoy it.

### The trivial end of the wedge ###

An example of the need to be friendly to potential users isn't even ElasticSearch specific, it's a common theme it seems with Rust code.  Under what circumstances should a function borrow a string using `&str` and when should it require an owned `String` be moved in to its grasp?

[The Rust book recommends `&str`](https://doc.rust-lang.org/book/strings.html) on the grounds that it's the cheapest option as it doesn't force the user to allocate a `String` especially.  This makes a lot of sense, especially seeing as a `String` can be coerced to `&str` just by simply doing `&owned_string`.  But on the other hand, the Query DSL needs an owned `String` because that's what the Json library needs; and many users of my library will be dynamically creating strings especially anyway, so would almost certainly own them; moving those would make sense, otherwise the path would be `String` to `&str` to a brand new `String` identical to the first one.  However, I didn't want to enfore the use of `String` everywhere either, because a significant proportion of use-cases would have various strings (such as index names) as effective constants; forcing the user to allocate these strings everytime is just anti-social, if the library needs it the library should do it.  I didn't want ```"index_name".to_string()``` everywhere.

The good thing about such fundamental questions is that there's a good chance someone else has already thought about them, and indeed [Rust has a solution built in](http://hermanradtke.com/2015/05/06/creating-a-rust-function-that-accepts-string-or-str.html), namely the `Into` trait.

By defining my functions to accept `Into<String>` I could accept both `String` and `&str`.  If the user had an owned `String`, happy days, it'll be moved into place; if the user has a `&str`, then the library will allocate a `String` and carry on from there.  But the user-friendliness is preserved.  ```my_function("constant_string")``` and ```my_function(format!("dynamic_{}", val))``` both work.

It was at this stage I thought: "hang on a moment, if I accepted Into<MiscellaneousType> for everything, I could make any consumer code shorter and not lose any type-safety."

### The more complex examples ###

ElasticSearch's Query DSL has a number of dynamic context-specific fields.  Values can be a single value or an array; the content could be a string, an integer, or even another map contain GeoJSON.  This is a text-book example of Duck Typing, and clients in dynamic languages can just ignore it, just write the code you want and ignore it.

But my decision to go-with-the-flow regarding Rust, and therefore to make a type-safe client, meant I couldn't do that.  But the first version was quite unpleasently verbose.  To show the evolution of my approach, let's pick an example:

#### Geo Bounding Box filter ####

A [Geo Bounding Box filter](https://www.elastic.co/guide/en/elasticsearch/reference/1.5/query-dsl-geo-bounding-box-filter.html) can be used to find documents which have a `geo_point` within the defined box.  Sounds simple?  It gets complex due to the number of options that a developer has to define the box: either the corners (top-left, and bottom-right) can be provided, or the four (top, left, bottom, right) values can be given independently, but if corners are used those points can be defined in terms of lat-lng pairs or can be geohashes.  I decided to support all of these options rather than force any consumers of `rs-es` to using a subset.

There are certain options that can be ignore, however.  ElasticSearch allows lat-lng pairs to be defined in a number of ways, either JSON:

<pre>
"location": {
    "lat": 50.5,
    "lon": -10.5
}
</pre>

or arrays: `[-10.5, 50.5]` (note the lng-lat ordering), or even strings: `"50.5, -10.5"` (not the lat-lng ordering).  All three are equivalent, so I can generate one and ignore the others.

So to begin with, I need a enum defining choices for `GeoBox`:

<pre>
pub enum GeoBox {
    Corners(Location, Location),
    Vertices(f64, f64, f64, f64)
}
</pre>

and another one for the choice of `Location`:

<pre>
pub enum Location {
    LatLon(f64, f64),
    GeoHash(String)
}
</pre>

Putting it all together is where the horrible verbosity becomes apparent:

<pre>
Filter::build_geo_bounding_box("pin")
    .with_geo_box(GeoBox::Corners(Location::LatLon(50.5, -10.5),
                                  Location::LatLon(50.0, -10.0)))
    .build();
</pre>

Not great compared to the JSON it produces, although arguably easier to understand:

<pre>
"geo_bounding_box": {
   "pin": {
       "top_left": {"lat": 50.5, "lon": -10.5},
       "bottom_right": {"lat": 50.0, "lon": -10.0}
   }
}
</pre>

### So... traits? ###

The solution to the verbosity problem was obvious after solving my `String` vs. `&str` problem.  I would define the `with_geo_box` function, and any other such function, to take anything that implements `Into<GeoBox>` rather than just `GeoBox`.  This means that the full verbose option still works, but allows various shortcuts.

For example, the verbose example above could be written:

<pre>
Filter::build_geo_bounding_box("pin")
    .with_geo_box(((50.5, -10.5), (50.0, -10.0)))
    .build();
</pre>

This is because the tuple `((f64, f64), (f64, f64))` implements `Into<GeoBox>`.  Similar provisions are made for `(f64, f64, f64, f64)` for the `Vertices` version, and for `(String, String)` for the geohash version.  This is achieved by simply implementing the `From<whatever> for Location` trait for each required combination:

<pre>
impl From<(f64, f64, f64, f64)> for GeoBox {
    fn from(from: (f64, f64, f64, f64)) -> GeoBox {
        GeoBox::Vertices(from.0, from.1, from.2, from.3)
    }
}
</pre>

and so on.

Of course having to write five nearly identical lines for very similar functions has a high noise-to-signal ratio, but fortunately Rust has macros, the above then becomes:

<pre>
from_exp!((f64, f64, f64, f64), GeoBox, from, GeoBox::Vertices(from.0, from.1, from.2, from.3));
</pre>

The code behind this is in the template that the code-generator uses to produce the full implementation of the Query DSL.  This can be [seen here](https://github.com/benashford/rs-es/blob/master/templates/query.rs.erb#L27).

### Conclusion ###

This has been applied essentially everywhere in the code that implements the Query DSL, and it shows that using simple traits can have a big impact in the design of APIs.

There are still many challenges, as various parts of the ElasticSearch API are subtly inconsistent however.

##### Footnotes #####
[^1]: I've written 2.5 such clients in Clojure alone, the .5 is a half-finished implementation I'm intending on open-sourcing eventually.
