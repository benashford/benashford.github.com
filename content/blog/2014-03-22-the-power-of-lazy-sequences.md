+++
path = "/blog/2014/03/22/the-power-of-lazy-sequences/"
title = "The power of lazy sequences"
date = "2014-03-22"
description = ""
[taxonomies]
categories = ["blog"]
tags = ["clojure", "lazy-evaluation"]
+++
The selling-pitch for the concept of lazy evaluation includes the claim that they can, if used in the right way, improve performance.  Indeed, the new Stream API in Java 8 vaguely references that [laziness exposes "opportunities for optimisation"](http://download.java.net/jdk8/docs/api/java/util/stream/package-summary.html).

But how much effect can this have.  Well lets look at an example shall we: sorting in Clojure.

Clojure, of course, has a ```sort``` function as part of the core namespace[^1].  This is defined as a thin wrapper around the sorting functionality of Java, i.e. it converts the collection into an array, then calls ```sort``` on ```java.util.Arrays```[^2], which ought to be pretty fast.  It takes the pragmatic approach of leveraging the underlying platform, same as so many other Clojure features.  This pragmatism means it will beat a purer implementation which embodies functional programming and immutable data structures.

But what if we had a lazy sorting algorithm?[^3]

<script src="https://gist.github.com/benashford/9716335.js"></script>

This doesn't make any optimisations beyond being lazy; it has no side-effects, it uses no mutable datastructures, so surely stands no chance against the built-in function?

Let's test it.  Let's define a vector of 50000 random numbers, and sort it with both implementations:

<pre>
(def rand-nums (into [] (repeatedly 50000 #(rand-int 1000000))))
</pre>

Built-in ```sort``` (note: the use of ```doall``` is not strictly necessary, but is here because it's needed when testing ```lazysort```, otherwise the sequence won't be consumed and it will take no time at all):

<pre>
lazysort.core> (time (do (doall (sort rand-nums)) nil))
"Elapsed time: 44.188 msecs"
</pre>

And my ```lazysort```:

<pre>
lazysort.core> (time (do (doall (lazysort rand-nums)) nil))
"Elapsed time: 528.527 msecs"
</pre>

Yep, as expected, it's quite a bit slower.  So where, exactly, do the optimisations of lazy sequences manifest themselves?  One significant benefit is short-cutting.  Lazy evaluation can be stopped when no-further results are expected and/or needed, this could leave a significant amount of work undone.

So going back to our vector of random numbers, what if we didn't care about the precise order of everything?  What if we only wanted the first hundred items from the sorted sequence?

Built-in ```sort```:

<pre>
lazysort.core> (time (doall (take 100 (sort rand-nums))))
"Elapsed time: 39.693 msecs"
(11 60 80 88 110 131 132 145 178 179 193 216 253 256 311 344 354 381 424 424 477 478 520 527 646 658 676 677 684 696 716 721 737 775 812 821 843 848 864 902 939 939 947 949 949 962 969 980 989 1064 1069 1075 1173 1196 1199 1204 1209 1218 1236 1240 1285 1293 1346 1359 1369 1432 1477 1494 1508 1518 1553 1560 1603 1672 1710 1719 1772 1775 1795 1797 1824 1856 1864 1895 1932 1940 2020 2021 2075 2088 2098 2102 2105 2126 2143 2157 2164 2263 2263 2279)
</pre>

The performance is about the same, in the region of 40 milliseconds.  This is expected, of course, the whole 50,000 items are being sorted before the first 100 items are picked.  Let's try ```lazysort```:

<pre>
(time (doall (take 100 (lazysort rand-nums))))
"Elapsed time: 10.894 msecs"
(11 60 80 88 110 131 132 145 178 179 193 216 253 256 311 344 354 381 424 424 477 478 520 527 646 658 676 677 684 696 716 721 737 775 812 821 843 848 864 902 939 939 947 949 949 962 969 980 989 1064 1069 1075 1173 1196 1199 1204 1209 1218 1236 1240 1285 1293 1346 1359 1369 1432 1477 1494 1508 1518 1553 1560 1603 1672 1710 1719 1772 1775 1795 1797 1824 1856 1864 1895 1932 1940 2020 2021 2075 2088 2098 2102 2105 2126 2143 2157 2164 2263 2263 2279)
</pre>

It only requires a quarter of the time, being able to stop early saves significant time.  There are literally hundreds of cases when this kind of short-cut is done in large applications, and shows how much of a benefit lazy sequences and lazy evaluation generally can actually have.

#### Tradeoffs ####

An earlier version of the ```lazysort``` function used a ```group-by``` rather than using ```filter``` and ```remove``` to obtain the items before and after the pivot.  My thinking was that although ```group-by``` is an eager operation, not lazy, everything in the resulting sequence would be scanned once anyway and would save double-comparing each element.

In practice however, this earlier version was twice as slow when reading the first 100 results for a sorted sequence, albeit faster when sorting the entire sequence.

You can see the earlier version if you examine the history of the gist.

#### Update ####

The timings above are from the first published version of this post.  There are newer benchmarks, more accurately taken, in my newer post [The folly of benchmarks](/blog/2014/12/07/the-folly-of-benchmarks).

#### Footnotes ####

[^1]: <a href="http://clojure.github.io/clojure/clojure.core-api.html#clojure.core/sort">http://clojure.github.io/clojure/clojure.core-api.html#clojure.core/sort</a>
[^2]: <a href="https://github.com/clojure/clojure/blob/c6756a8bab137128c8119add29a25b0a88509900/src/clj/clojure/core.clj#L2742">https://github.com/clojure/clojure/blob/c6756a8bab137128c8119add29a25b0a88509900/src/clj/clojure/core.clj#L2742</a>
[^3]: This implementation is mine, but it's not an original idea.  It's essentially Quicksort after-all.
