---
layout: post
title: "The folly of benchmarks"
description: ""
category: "blog"
tags: clojure benchmarking jvm
---
{% include JB/setup %}

In my previous post [The power of lazy sequences](/blog/2014/03/22/the-power-of-lazy-sequences) I fell in to a trap.  A common trap, one which most of us fall, some of us quite regularly.  I talk, of course, of trying to measure execution time.

In my defence, given the context of that post, some kind of elapsed-time measurement was needed as it would have been mostly conjecture otherwise.  Accurately measuring elapsed time, however, is actually quite difficult.  There were two specific problems with my approach: first, I was using `clojure.core`'s `time` function[^1]; second, I had not paid any attention to any JVM parameters.

`time` simply measures a single invocation, and while I had manually called each function a number of times before taking my measurements, and the elapsed time had appeared to stabilise[^2], there was still a degree of varience on each call; it wasn't exactly scientific.

Ignoring the JVM settings was an even bigger error, as it turns out that Leiningen disables certain JVM optimisations in order to achieve faster load times.  A deployed uberjar will be running with default settings, but running the code via `lein repl` will be slower.[^3]  You may think that this doesn't matter, as it's the same for both tests, but there is an unknown factor of how the disabled JVM transformations would have impacted each one; in theory, the lazy version has the most to gain as it has the most method calls, which could be inlined, and also temporary objects, which could be stack allocated.  That final claim is conjecture, so let's put it to the test!

#### The test and results ####

First, I stop Leiningen from changing any JVM settings, the test will now run with the default JVM settings.  Second, I use a proper benchmarking tool designed to deal with the difficulties of measuring execution time on the JVM, specifically I'm using Hugo Duncan's [Criterium](https://github.com/hugoduncan/criterium).

The test was the same as the previous post.  50,000 random integers between zero and 1,000,000 were generated; the first 100 ordered naturally were selected.  The test was performed on the same hardware.

The results for the eager sort of the entire vector, followed by taking the first 100:

<pre>
lazysort.core> (bench (do (doall (take 100 (sort rand-nums))) nil))
WARNING: Final GC required 2.890797395019582 % of runtime
Evaluation count : 2760 in 60 samples of 46 calls.
Execution time mean : 22.063202 ms
Execution time std-deviation : 489.021271 µs
Execution time lower quantile : 21.444953 ms ( 2.5%)
Execution time upper quantile : 23.258641 ms (97.5%)
Overhead used : 1.777138 ns

Found 3 outliers in 60 samples (5.0000 %)
low-severe   3 (5.0000 %)
Variance from outliers : 10.9452 % Variance is moderately inflated by outliers
</pre>

With the default JVM options enabled, the elapsed time went from 39.6ms to 22.1ms (reduced by 44.2%).

The results for the lazy sort, taking the first 100:

<pre>
lazysort.core> (bench (do (doall (take 100 (lazysort rand-nums))) nil))
Evaluation count : 11640 in 60 samples of 194 calls.
Execution time mean : 5.086969 ms
Execution time std-deviation : 61.738542 µs
Execution time lower quantile : 4.966331 ms ( 2.5%)
Execution time upper quantile : 5.220216 ms (97.5%)
Overhead used : 1.777138 ns

Found 2 outliers in 60 samples (3.3333 %)
low-severe   2 (3.3333 %)
Variance from outliers : 1.6389 % Variance is slightly inflated by outliers
</pre>

In this case the elapsed time went from 10.9ms to 5.1ms (reduced by 53.2%).

#### Conclusion ####

The execution time of both was significantly improved, and indeed the lazy version gained the most.  The real conclusion however: there are good tools for this sort of thing which are better than drawing conclusions from ad-hoc timing code.

#### Footnotes ####

[^1]: Not that there is anything wrong how that function is implemented, just that it is better suited for timing real-world situations rather than benchmarks.
[^2]: The first call is almost always the slowest, as the JVM will be loading any referenced classes etc.  Subsequent calls may still be slow, as the Hotspot compiler does its work.
[^3]: <a href="https://github.com/technomancy/leiningen/wiki/Faster#tiered-compilation">https://github.com/technomancy/leiningen/wiki/Faster#tiered-compilation</a>
