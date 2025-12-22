+++
path = "/blog/2014/12/27/group-by-and-transducers/"
title = "group-by and Transducers"
date = "2014-12-27"
description = ""
[taxonomies]
categories = ["blog"]
tags = ["clojure", "transducers"]
+++
One of the random, but very useful, functions in `clojure.core` is the venerable [`group-by`](https://clojure.github.io/clojure/clojure.core-api.html#clojure.core/group-by).  Simply take a collection of something, a function to extract a key, and it returns a map of the same data indexed by the key.  It's incredibly useful, I use it all the time.

But it's also annoying.  Why?  Because often, perhaps even the majority of the time, I want to do some something with the values after they've been grouped; something that couldn't be done before hand.  Examples of this include: a) removing the key used to index the data, b) applying functions that only make sense post-grouping - e.g. removing duplicate values.

Let use that first example to go into more detail.  I often end-up dealing with data that is essentially a series of pairs, where the first element is an ID of some description, and the second is the data, often a map of some kind.  Using completely made-up data, it often looks like this:

<pre>
[[:a 1] [:a 2] [:b 3] [:a 4] [:c 5] [:b 6]]
</pre>

Using `group-by` on this gives me:

<pre>
{:a [[:a 1] [:a 2] [:a 4]], :b [[:b 3] [:b 6]], :c [[:c 5]]}
</pre>

Which groups by the first element, as I ask, but the values contain much redundant data.  So, of course I remove them afterwards, but this leads to ugly code as I iterate over this first map and produce a second one:

<script src="https://gist.github.com/benashford/7b9820e56f510c19b1c3.js"></script>

The uglyness can be easily addressed by making this a generalised function so I'd never need to see the internals.  Just as `group-by` takes a function to extract the key, this better group-by could take two functions - one to extract the key, the second to extract the value.  Although this does still leave a problem of intermediate short-lived maps and sequences.  I might as well not call the standard `group-by` at all, and just implement it all myself:

<script src="https://gist.github.com/benashford/198bd6bc0ccb4220bda8.js"></script>

This maintains the key contract of `group-by`, namely returning a map with vectors as values, but strips out the data I'm not interested in:

<pre>
group-transduce.core> (group-by-better first second example-data)
{:c [5], :b [3 6], :a [1 2 4]}
</pre>

Much better.  But hang on a minute, what about my other example.  If I wanted to do other group-specific processing, like removing duplicates, I need to take apart the map and put it back together again; either that or create a number of distinct group-by functions for different circumstances.  Neither of which felt like a particularly happy solution.

### Transducers ###

Then, of course, the repressed memories of the various blog posts and videos regarding [transducers](http://clojure.org/transducers) all came back.  Is this, after all, the same sort of thing that transducers were invented for?

I won't try and explain in detail what transducers are, or how they work; many people with better credentials have tried, and still left confusion in their wake.  See the HN discussion on the original announcement: [https://news.ycombinator.com/item?id=8143905](https://news.ycombinator.com/item?id=8143905).  But they're not as complex as they might sound, if I were to try and explain in one single gross over-simplification I'd say they are an application of a higher-order function, but with "applied to" bit removed.  So, in a usual application of a higher-order function you'd apply it to some data: ```(map function data)```; but in Clojure 1.7: ```(map function)``` returns a transducer that can then be applied to, well, anything.  A transducer could be applied over a collection, which would behave the same way as the pre-existing higher-order functions, but it doesn't have to be; it could, in theory, be applied during a group-by operation to achieve the goals I mentioned above in a single operation without temporary maps and sequences...

So, if I were to implement a `group-by-with-transducer` function (I can think of a better name later!) what parameters would it take?  It would still need a function to extract a key for the data to be grouped by, then a transducer for what happens next, finally the data to be grouped.  The equivalent of my previous `group-by-better` example above would be: `(group-by-with-transducer first (map second) data)`.  This looks good to me, it reads as it does: group by the first element of the data, then map second over the results.

How would one implement such a function?  Well, for starters, transducers can be stateful; this has two specific implications for this function: 1) we need one instance of the transducer for each group, and 2) we need to explicitly close the transducer at the end, to ensure that any state is flushed.  Secondly, transducers can terminate early (think of the `take` function as an example), this needs to be taken into account; we can stop sending data through the transducer instance when this happens (although we do still need to close it).

What would this function look like?  A bit like this:

<script src="https://gist.github.com/benashford/a9ea85225f4984174235.js"></script>

The parameter `xf` is the transducer.  `ff` is a function that returns the particular instance of the transducer for the given key; here we use `conj` as the reducing function for this instance of the transducer because we're building a vector for the value in the map.

The middle-part of the function is essentially the same as the `group-by-better` function before, but with the difference of passing each element of `data` through the instance of the transducer.  This "instance of the transducer", as I've been calling it, is now performing the same action as `conj` did in the non-transducer examples; transducers turn one reducing function into another one.  So if we called this function with `(map second)` as the value of `xf`, the function is doing the same thing as `(conj v (second d))`.  And now suddenly transducers all make sense.

The final line of the function is closing the transducer.  For stateless transducers this is a no-op, but for stateful transducers like the result of `(partition-all 3)` it flushes anything remaining, and for any reduced values (e.g. `take`) this unwraps it and returns the actual value.  The final line also makes use of a transducer, which is interesting.

### Testing ###

<pre>
group-transduce.core> (group-by-with-transducer first (map second) example-data)
{:c [5], :b [3 6], :a [1 2 4]}
</pre>

Works a treat.  Let's try it with a stateful transducer to make sure that works, I'll partition the values of the map using `(paritition-all 2)`:

<pre>
group-transduce.core> (def xf (comp (map second) (partition-all 2)))
#'group-transduce.core/xf
group-transduce.core> (group-by-with-transducer first xf example-data)
{:c [[5]], :b [[3 6]], :a [[1 2] [4]]}
</pre>

Let's also try with an early-terminating operation:

<pre>
group-transduce.core> (group-by-with-transducer first (comp (map second) (take 2)) example-data)
{:c [5], :b [3 6], :a [1 2]}
</pre>

Nice.

### Performance ###

There are two advantages of this transducer based approach.

Firstly, it's less code.  We have one reusable function `group-by-with-transducer` (note to self: really must find a better name), and any subsequent operations are composable predictable transducers.

Secondly, it ought to be faster.  There's less intermediate data, it's just function calls.  But, notwithstanding my previous warnings [on the folly of benchmarking](/blog/2014/12/07/the-folly-of-benchmarks/), I can't make claims on performance without testing it.

But first we need to invent a meaningful test.  Let's use my original use-case.  We have a vector which is a series of 1,000 pairs; we want to group by the first value of each pair, then collect the second removing duplicates as we go.  Then I can compare an old-school implemetation with one that calls `group-by-with-transducer`.

#### The test data ####

I'll create some randomly generated test data to use:

<pre>
group-transduce.core> (def ks [:a :b :c :d :e :f :g :h :i :j])
#'group-transduce.core/ks
group-transduce.core> (def vs (into [] (range 50)))
#'group-transduce.core/vs
group-transduce.core> (def test-data (take 1000 (repeatedly (fn [] [(rand-nth ks) (rand-nth vs)]))))
#'group-transduce.core/test-data
group-transduce.core> (take 5 test-data)
([:c 13] [:j 38] [:j 3] [:f 19] [:g 12])
</pre>

#### The old-school version (without using transducers) ####

Creating a function to use as the 'control' in an experiment is always controversial.  It would be very easy to create a bad implementation, just to show how dramatically better the new version is; similarly it would be easy to create a custom function that does exactly what it needs to do, this would be fast, but wouldn't be the type of code you would see in-the-wild.  For the purposes of this test I will use a variation of the example I gave in the opening paragraphs:

<script src="https://gist.github.com/benashford/5ac62f26a6d568f2f244.js"></script>

This does test both composing standard functions where possible with performing post-grouping actions in a fairly direct way.

How does this perform?  Tested with Clojure 1.7.0alpha4, using the Criterium library to benchmark the function:

<pre>
group-transduce.core> (bench (complex-example-1 test-data))
Evaluation count : 70620 in 60 samples of 1177 calls.
             Execution time mean : 857.557453 µs
    Execution time std-deviation : 19.955623 µs
   Execution time lower quantile : 821.684737 µs ( 2.5%)
   Execution time upper quantile : 895.128919 µs (97.5%)
                   Overhead used : 1.764232 ns
</pre>

The headline number is 0.858ms to transform the data as described.

#### The new version (using transducers) ####

The first hurdle here is that I need a `distinct` transducer, but there isn't one in the standard library.  So I will create one myself[^1], I base this on how other transducers are implemented; you will also see it is a stateful transducer.

<script src="https://gist.github.com/benashford/94307b42547029e9fba1.js"></script>

Let's just test this to make sure it works:

<pre>
group-transduce.core> (group-by-with-transducer first (comp (map second) (distinct-transducer)) [[:a 1] [:b 2] [:b 1] [:b 2]])
{:b [2 1], :a [1]}
</pre>

And then plug it in to our test harness:

<script src="https://gist.github.com/benashford/6461848ad579d271f163.js"></script>

And then benchmark it using the same test data as the previous benchmark:

<pre>
group-transduce.core> (bench (complex-example-2 test-data))
                Evaluation count : 85080 in 60 samples of 1418 calls.
             Execution time mean : 713.997396 µs
    Execution time std-deviation : 11.890208 µs
   Execution time lower quantile : 695.413537 µs ( 2.5%)
   Execution time upper quantile : 731.740410 µs (97.5%)
                   Overhead used : 1.764232 ns
</pre>

The headline number is 0.714ms.  Which is faster by 0.144ms, or 17% faster... not to be sniffed at.

### Conclusion ###

The time saved by not using intermediate sequences and data-structures is actually quite significant.  Add to this the fact that transducers allow kinds of composition that weren't possible before, not without constructing multiple versions of the similar functions, and it immediately seems that transducers are the answer to a wide array of situations.

##### Footnotes #####
[^1]: See my previous controversy disclaimer.
