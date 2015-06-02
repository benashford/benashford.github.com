---
layout: post
title: "Java in a polygot JVM world"
description: ""
category: "blog"
tags: clojure java jvm
---
{% include JB/setup %}

The trend over the last few years has been clear, the [number of viable platforms from which to build software systems has been growing](http://redmonk.com/dberkholz/2014/05/02/github-language-trends-and-the-fragmenting-landscape/).  Not that many years ago, things would be either: Java, C++, Visual Basic or one of the many long-forgotten but once popular languages like Delphi.  These days, things are either: JavaScript, Java (also: Clojure, Scala, Kotlin, Groovy), .NET (C#, F#), Ruby (including JRuby), Python (2 and 3, and all the interesting Python community sub-projects like PyPy and rpython), Rust, Go, C, C++, Haskell, OCaml, Erlang (and Elixir), Nim, Crystal, it goes on and on...  Not every language is suitable to every task, but there's a surprisingly wide central area of suitability that nearly all of the above overlap.

Despite many online programming forums regressing to a continual flame-war on the subject of "which language will win"[^0], it's quite clear this fragmentation[^1] is here to stay, at least for the forseeable future.  Coupled with this is the habit of programmer communities forming language-tribes, which is a great shame as real-world code suffers as a result of tribal dogma[^2][^2a].

I would be suspicious of any programmer who claimed to be an expert in all these programming languages, unless their name were Fabrice Bellard to TJ Holowaychuk perhaps.  But I firmly believe in the principal of understanding multiple ways of doing things, there is no one-true-answer to everything (although there are nearly-one-true-answers to some things).

So, in todays diverse programming world, in which situations would you use an old, unfashionable, language like Java?  Especially if you're already using a modern, fashionable, language like Clojure.  They both target the JVM, so surely you'd use the newer one, unless there was an explicit need for performance.  Actually, I would say no, there are a lot of problem-domains for which Java is very well suited.

### An example ###

First, why Clojure?  There has been a metaphorical avalanche of praise for Clojure the past few years, so I won't repeat the full list, not least because the full list includes things I don't really agree with; but there are many clear-cut advantages that Clojure has.  By all means this list isn't unique to Clojure, pretty much everything in it also exists in at least one other language, and the benefits don't apply equally to all application domains; but the fact that they exist together, in a language that targets ubiquitous platforms (JVM, JavaScript, etc.) makes it a very good general-purpose programming language.  For the record, I believe the key benefits of Clojure are: a) functional programming, not just a "functional optional" approach like Scala[^3]; b) immutable data-structures and language support for STM, etc.; and c) macros[^4], and how that enables `core.async` and other such libraries.

A few months ago I had an idea for a side-project that required a bit of data-mining.  My initial idea for the architecture was to use `core.async` as there were excellent asynchronous libraries available for both ends of the pipeline; however in the middle, to keep track of state and various pieces of transient data, I planned to use Redis.  As it happened, I quickly realised the size of the data was small, so I implemented the whole thing in-memory in a single Ruby script instead, but that's another story; by this time the problem of how to talk to Redis in an application heavily based around `core.async` was firmly in my mind, so I deced to do something about it.

I'm aware of half-a-dozen Redis clients for Clojure, and have used a couple of those.  The current market leader is the excellent [Carmine](https://github.com/ptaoussanis/carmine)[^5], it's fast, it's complete, what's not to like?  However it does use blocking IO for most operations.  Since beginning on [my client](https://github.com/benashford/redis-async) I have become aware of other experimental forays into this area, but I wasn't aware of them at the time, and none of them look like the finished article.

(Incidentally, Carmine is a good project to read if you want to know how to write good idiomatic Clojure.)

### redis-async ###

My project [`redis-async`](https://github.com/benashford/redis-async) quickly gained shape in my mind.  It had the following design goals:

* To be a complete Redis client.
* To be asynchronous, specifically non-blocking to any consumers.
* To use `core.async` features (e.g. channels) rather than other mechanisms (e.g. callbacks or promises).  This was mainly as I envisaged the need to integrate with other `core.async`-based code.  Internally there may be callbacks, but the external interface would be channels.

The complications were many and varied too.  Not least the need to square a few circles regarding idiomacy; for example: a Redis string is what the Java/Clojure world would call a byte array - but yet most uses would require a Clojure/Java string; however there are some Redis commands where a consumer would require a byte array (`DUMP` and `RESTORE` plus others), so automatically converting would be incorrect.

The initial decision was how to go about this.  There were three strands that went through my mind:

1. Forget about the non-blocking IO entirely, Redis is fast, it's unlikely to cause deadlock, it'll just lead to an inefficient use of the threadpool that backs Go blocks.  (I quickly dismissed this as being a dangerous path, there's no reason why talking to Redis couldn't be implemented asynchronously.)
2. To use `core.async` channels to communicate with one-or-more threads (i.e. full threads, not go blocks) that call Carmine functions.  (Tempting, but again the Redis protocol isn't that complicated that the lack of an off-the-shelf library is a show-stopper.)
3. Implement the Redis protocol myself, and use a low-level non-blocking library for the networking.

I chose Option 3.

The single major difference between synchronous and asynchronous communication, is how you go about reading the responses.  Synchronously you would read from an `InputStream` until you have the data you are expecting (Redis is deterministic in this regard.); if the data is not yet available, the thread will block until it is.  Asynchronously, you will receieve a sequence of events, each of which contain an arbitrary amount of data; each event could contain multiple messages, but also an event may contain only part of a message; client code needs to combine multiple events to reconsititute a single message.

#### The Redis protocol ####

The [Redis protocol](http://redis.io/topics/protocol), known as RESP, is designed to be simple to implement, that must be true because that's what it says at the top of its own documentation.  It's made-up of a few simple types covering strings (byte-arrays), integers, arrays etc.  It has a few fun peculiarities, like the fact that numbers are transmitted as strings, but this was done to make it human readable.

Communication both to and from a Redis server is a stream of RESP objects.  A Redis command is just a RESP array where the elements are the command plus any options, each encoded as RESP.  E.g. `SET KEY-NAME VALUE` is sent over the wire as `*3\r\n$3\r\nSET\r\n$8\r\nKEY-NAME\r\n$5\r\nVALUE\r\n`[^6][^7].  Responses are similarly encoded, but the exact response varies according to the command; you can be sure that one command results in one response...

...except for those that don't.  There are a number of commands with different semantics.  Some like the "blocking" commands (e.g. [`BLPOP`](http://redis.io/commands/BLPOP)) still return one command, but the client will have to wait for it if it's not already there; others like the various [Pub/Sub](http://redis.io/topics/pubsub) commands will subscribe you to a channel and there will be an indefinite number of responses.

#### The first iteration ####

In any application space there are a number of libraries that are so widely adopted they're the de-facto choice.  For asynchronous networking in Clojure, that library is [Aleph](https://github.com/ztellman/aleph), which in-turn is based around the venerable Java library [Netty](http://netty.io).  Zach Tellman also owns a number of other good libraries which I would use in this first iteration, in particular [Gloss](https://github.com/ztellman/gloss).

Gloss was used to implement the Redis protocol, and Aleph used to transmit data back-and-forth.  Gloss is very easy to integrate with Aleph and it handles the problem of messages being split over multiple callbacks, my code just read fully formed RESP messages.

Once this was up-and-running it was time for a quick benchmark against Carmine.  Now, before I tell you the numbers, let me get my excuses in first: I was expecting it to be slower, for many reasons, but mainly two:

One, Carmine is very fast[^8], and the [code it uses for reading and parsing RESP](https://github.com/ptaoussanis/carmine/blob/master/src/taoensso/carmine/protocol.clj) is very clean and straight forward.  It essentially comes down to [one function](https://github.com/ptaoussanis/carmine/blob/master/src/taoensso/carmine/protocol.clj#L123-L189) that reads the data from a Java `InputStream` into precise chunks.  Asynchronous code would have to take a different approach, messages could be split across packets; even though this was handled for me by Gloss, it was still a runtime cost.

Two, Carmine is very direct.  `redis-async` on the other hand would, by design, receive this incoming piece of data, route it to the waiting channel; somewhere else, in another thread, the arrival of this message would trigger the resumption of a go-block waiting on that channel; finally that code would do whatever it needed to do with the result.  There was bound to be an overhead to all this.

So the results?  First, the experiment: it was very basic, I would send 1,000 `PING` commands and wait for 1,000 `PONG`s to be returned.

Carmine achieved this in 2.66 milliseconds.  `redis-async`, well, let's just say it had a 2 in it... it was in the hundreds of milliseconds.

Superficially they were doing the same thing, both were pipelining their commands.  Carmine was returning a single result as a vector, however `redis-async` was distributing 1000 `PONG`s to their respective channels, which were then being waited on to be sure all the results were in.  It was obvious that would take some time, but not 99% of a couple of hundred milliseconds worth.  Surely?

It's also true-to-say that the chosen experiment was the one most likely to flatter Carmine given what was known about the implementation, and a more typical test would have produced a narrower result.  But the gap was so massive I decided not to equivocate, the baseline would have to be improved either way.

#### The second iteration ####

A series of isolated tests on the individual layers showed that it was the de-serialization steps, going from binary to records that described the RESP types, was where the most time was being spent.  And even more specifically, it was RESP's "simple strings" that were the problem.  In my isolated test, replacing them with bulk strings made everything many times faster.  But, since simple strings were in the protocol, this would have to be addressed.

I decided to drop Gloss, and implement the protocol myself.  The reason was that I was rapidly accumulating extra cases to handle RESP, and the weight of these meant that Gloss was no-longer the simplest solution; the logic was lost amongst the workarounds.

The second iteration still used Aleph, but took the raw byte data and did all the parsing (and handling split messages) itself.

The results for the second iteration were much improved, but not stellar.  It was in the low hundreds of milliseconds initially, which after a few tweaks, I got down to the ~90ms mark.

### Where Java fits in the modern polygot JVM-based world ###

Looking at [the code I had written](https://github.com/benashford/redis-async/blob/c0e34395bd20c2b0a84c47ddca4a7fdb6eb2da04/src/redis_async/protocol.clj) there was much to dislike.  First, there was a lot of it for such a simple protocol; it was very low-level dealing with individual bytes and byte-buffers; it wasn't functionally pure, the buffers were mutable; there was a lot of other state, but all of it was passed around as a parameter.

The conclusion to this was obvious: why don't I just write it in Java?  The Clojure version could be improved, just as the Gloss version in the previous iteration could have been; however, the direction I wanted to take (in both cases) was to move further away from the strength of those technologies.  The game was stateful byte-by-byte manipulation, I might as well choose a starting point that makes that game easier to play.

#### The third iteration ####

I decided to split `redis-async` in two.  Everything that was in `protocol.clj` or lower would be re-written in Java; everything else would stay in Clojure.  This would mean the [Java library, or JRESP - Java RESP](https://github.com/benashford/jresp) - would provide objects representing each RESP type (Array, Bulk String, Simple String, etc.), and also the means to read and write them to Redis instance.

Aleph was removed as a dependency, but Netty is still used by the Java code.  What was the result?

* There's less code.  You would expect a reduction of code going from Java to Clojure, not the other way around.  The code is spread out over a much wider area however, on account of Java's one-public-class-per-file rule.
* The code is conceptually simpler.  The structure is obvious, and the areas were significant events occur (e.g. parsing data) are easily identified.
* The state is held by the language making the logic easier to follow.

The Clojure parts now simply call the `write` method on the `Connection` object to send a set of commands, the Clojure code also implements the callback from the `Connection` object, writing the result to the `core.async` channel that is used to allocate results back to specific channels.[^9]

So what about the performance?  Well, there's good and bad news.  The bad news is that the full-client is still slower than Carmine, but the time for 1000 `PING`/`PONG`s is under 50ms.  The good news is that, by timing just the Java layer, the speed is significantly improved.  Measured at that layer 1000 pings is 2.9ms.

Both the Java version, and it's Clojure predecessor, is unoptimised; so I have no doubt both could be made faster still.  But comparing them both as initial versions is still interesting.  While the revelation that Java is faster than Clojure will come as a shock to nobody, it can still be worth measuring as the gains are non-linear; and still the JRESP and Carmine code are both very similar (although JRESP is still doing more work to asynchronously read the result, albeit a small amount of extra work).

As for the remaining 47.5ms, which is spent entirely at the Clojure layer, I haven't investigated yet.  It could be that this is the overhead of `core.async`.  It could also be that the nature of the 1000 ping test is untypical and I should do more typical tests before coming to conclusions.  Only then would I be able to put a price on this approach, then decide if such a cost actually works for the type of applications likely to use it.

The version of `redis-async` with JRESP is still in development.  I'm intending on doing more performance testing and testing of edge-cases before releasing it.

### Conclusion ###

The conclusion, like all good conclusions, is retrospectively obvious: low-level logic is a good candidate for low-level languages.  Perhaps not so obvious, especially with the modern zeitgeist of developer productivity being linked to expressiveness, is that low-level programming languages is the best medium for expressing low-level logic.

Java's role is essentially to be the C of the JVM.  For writing code that is low-level, needs to be performant and/or needs to be shared across multiple JVM languages; it would be relatively easy to create a Scala Redis client based on JRESP, and even a full Java client for that matter.

##### Footnotes #####
[^0]: Often this is a subtext of the actual topic at hand.
[^1]: I prefer the term "diversity".
[^2]: Once overheard: "we can't do that!  If we use a SQL database, we're only one step away from Java!"  All the while our competitors had a Java application based around a SQL database nicely satisfying all our potential customers without complaint...
[^2a]: Often such tribalism is rational, given those lines are often used in hiring practices.
[^3]: Although that might be beneficial for other reasons, at least the intent is clear.
[^4]: Dangerous, but revolutionary in the right hands.
[^5]: One of those impossible-to-Google project names.
[^6]: Yes, it's longer than just sending the string, this is normal; but it has removed ambiguity.
[^7]: For bulk string operations, those beginning with `$`, you are told the number of bytes to read but yet there's still a `\r\n` at the end.  The final `\r\n` is a bit of a nuisance, as you need to add two to the number of bytes to read, then remove it again.
[^8]: As I said before, it's a very good project to read if you want to learn idiomatic (yet high performance) Clojure code.  There's no fat in the entire project.
[^9]: _Warning_: The Java code does not yet enforce any thread-safety, this is because the way it is currently used is guarenteed to come from only one thread at a time.  This will change in the near future however, as this is an implementation detail of the Clojure implementation, and is likely not to be true for any other user of that library.
