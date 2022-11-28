#### Version: 1.1

Table of Contents
=================

  - [Introduction](#introduction)
  - [Conceptual Overview](#conceptual-overview)
  	- [Entities](#entities)
  	- [Activities](#activities)
  	- [Metadata](#metadata)
  - [Structure](#structure)
  	- [Tables](#tables)
  	- [Activity Stream](#activity-stream)
  	- [Entity Table](#entity-table)
  	- [Additional Metadata](#additional-metadata)
  - [Using an Activity Schema](#using-an-activity-schema)
  	- [Modeling](#modeling)
  	- [Querying](#querying)
  - [Known Activity Schema Implementations](#known-activity-schema-implementations)

# Introduction

The activity schema is a new data modeling paradigm designed for modern data warehouses. It was created and implemented by Ahmed Elsamadisi at [Narrator](https://www.narrator.ai).

This new standard is a response to the current state of modeling with star or snowflake schemas - multiple definitions for single concepts, layers of dependencies, foreign key joins, and extremely complex SQL definitions. It is designed to make data modeling substantially simpler, faster, and more reliable than existing methodologies.

The activity schema aims for these design goals

- **only one definition for each concept** - know exactly where to find the right data
- **single model layer** - no layers of dependencies
- **simple definitions** - no thousand-line SQL queries to model data
- **no relationships in the modeling laye**r - all concepts are defined independently of each other
- **no foreign key joins -** all concepts can be joined together without having to identify how they relate in advance
- **analyses can be run anywhere** — analyses can be shared and reused across companies with vastly different data.
- **high performance** - reduced joins and fewer columns leverages the power of modern column-oriented data warehouses
- **incremental updates** - no more rebuilding data models on every update

At its core an activity schema consists of transforming raw tables into a single, time series table called an activity stream. All downstream plots, tables, materialized views, etc used for BI are built **directly** from that single table, with no other dependencies. 

![image](https://user-images.githubusercontent.com/1216989/113028328-21cafc80-9159-11eb-972c-34d3617eb379.png)


The diagram above is the entire dependency graph: only three layers and a single data model. The modeling layer is able to create any kind of aggregation or table needed, and the consistent table structure allows data analyses to be written once and reused elsewhere. 

<br/>
<br/>


# Conceptual Overview

An activity schema models an **entity** taking a sequence of **activities** over time. For example, a **customer** (entity) **viewed a web page** (activity). 

An activity schema is implemented as a single, time series table with (optionally) a limited set of enrichment tables for additional metadata.

Each row in the table represents a single activity taken by the entity at a point in time. In other words, it has an activity identifier, an entity identifier, a timestamp, and some basic metadata called features. The specific structure is covered in the next section.

![schema_table](https://user-images.githubusercontent.com/1216989/113030867-0b727000-915c-11eb-8523-0da2f4411af0.png)

## **Entities**

Entities are the subject, or actor in the data. Every activity in the activity schema is an action taken by a specific entity with a unique identifier

The most common entity is a **customer**, but there can be other types as well. For example, a bike-sharing company could also have a **bike** entity to analyze things like repair frequency, mileage over time, etc. 

An activity schema table will only have one entity type and is typically named `<entity>_stream`. For example, an activity schema implementation for customers would be  `customer_stream`, and one for bikes would be `bike_stream`

 
<br/>
<br/>

## Activities

Activities are specific actions taken by an entity. For example, if the entity is a customer an activity could be 'opened an email' or 'submitted a support ticket'. Each row in a table modeled by an activity schema is a single instance of an activity taken by a specific entity.

Activities are intended to model real business processes. Taken together, the series of activities for a given entity would represent all relevant interactions that entity has had with a company. 


<br/>
<br/>


## Metadata

Every activity has metadata associated with it beyond the customer, the activity, and the timestamp. A 'viewed page' activity will want to store the actual page viewed, while an 'invoice paid' activity will store the total amount paid. 

The stream tables of an activity schema have a finite number of metadata columns that can be associated with each activity. For performance reasons, the most commonly used metadata are stored in the stream table, and in limited cases, an activity schema supports an unlimited number of additional metadata columns stored in a separate table. In practice fewer than 4% of activities need additional columns.  


<br/>
<br/>


# Structure

The primary benefit of an activity schema is that all data is in a consistent format. This means that it requires tables with specific names, types, and numbers of columns. 


<br/>
<br/>

## Tables

An activity schema uses a single table to store all activities. No new tables are created as the data evolves — any future activities will create rows in the same table. This is fundamentally distinct from other models, like a star schema, where each concept has its own 'fact' table. 

There are two types of tables in an Activity Schema

1. activity stream (one per activity schema)
2. entity table (optional - one per activity schema)

The activity stream table, (typically called `<entity>_stream`) stores all activities, their timestamps, the entity's identifier, and some metadata. 

The entity table (typically called `<entities>`) stores metadata for each entity. For example, a `customers` table can store date of birth, first and last name, etc.

The diagram below shows the two types of tables for our example bike stream. 

![bike_stream](https://user-images.githubusercontent.com/1216989/113031253-791e9c00-915c-11eb-8e84-bc743c8cafb8.png)


<br/>
<br/>

## Activity Stream

The activity stream table is the primary table in an activity schema and is the only one required. It houses the bulk of the modeled data in the warehouse. 

**Column**|**Description**|**Type**
-----|-----|-----
activity\_id|Unique identifier for the activity record|string
ts|Timestamp in UTC for when the activity occurred|timestamp
customer|Globally unique identifier for the customer|string
activity|Name of the activity (ex. 'completed\_order')|string
anonymous_customer_id |Unique identifier for an anonymous customer (ex. 'segment_abfb8a')|string
feature\_1|Activity-specific feature 1|string
feature\_2|Activity-specific feature 2|string
feature\_3|Activity-specific feature 3|string
revenue\_impact|Revenue or cost associated with the activity|float
link|URL associated with the activity|string
activity\_occurrence|How many times this activity has happened for this customer. Used to streamline queries.|integer
activity\_repeated\_at|The timestamp of next instance of this activity for this customer. Used to streamline queries.|timestamp
\_activity\_source|The transformation script that created this activity|string


<br/>
<br/>

### **Types**

Exact types can differ depending on the warehouse. For the purposes of the activity schema, most column types are strings with a maximum length of 255 characters. This limit is in place for performance and to keep the activity stream table compact. Additional, unlimited metadata can be added in enrichment tables. 

The only non-string columns are **ts,** **revenue_impact, activity_repeated_at,** and **activity_occurrence**

The **ts** and **activity_repeated_at** columns are timestamps with no time zone. Any type that specifies a specific date and time, timezone independent, will work. 

For example, in Redshift it would be a `TIMESTAMP`, not `TIMESTAMPZ`. In SQL Server it would be a `time` type. BigQuery would use `TIMESTAMP`. And so on.

By convention **ts** and **activity_repeated_at** are always understood to be in UTC. 

The **revenue_impact** column is a real number (float, decimal, numeric etc). The exact type or  precision is unspecified. There is no dedicated field for currency type (i.e USD). A feature column can be used for this if necessary. 

The **activity_occurrence** column is an integer. The integer size doesn't matter — a 4-byte integer is a sensible default.

<br/>
<br/>


### **Column Notes**

The **activity_id** can be any string as long as it's unique for the given activity. It is used to  identify a single activity instance. It can never be null.

The **activity** column is a simple string denoting the name of the activity — 'viewed_page' or 'opened_support_ticket'. By convention it's in the form verb_noun from the perspective of the entity — it should read as entity performed action. Any other form is fine as well. It's a best practice to use the same form across all activities when possible. It is case-sensitive and can never be null.

The **customer** column is the global identifier for the entity. It's typically an email address, but can be a phone number or serial number (eg. for a bike) or anything else that uniquely identifies the entity. IDs, uuids, and other computed identifiers ideally should be avoided, since they're not naturally unique. 

A single entity should have exactly one identifier in the activity stream across all their activities. In other words, don't mix multiple types of identifiers for different activities. A single entity cannot be identified with an email in one activity and a phone number in another. If so they will effectively be different entities. In fact, a given activity schema should only use **one** type of identifier for the **customer** column throughout. 

Note that the column name is always **customer** regardless of what kind of entity is modeled in a given activity stream. This is to keep the exact same structure for all activity stream tables. The more specific term 'customer' was chosen over the generic term 'entity', because in the vast majority of the time an entity is some form of customer.  For example, the diagram at the beginning of this section, showing a `bike_stream` table, has a **customer** column to represent bikes.

The **customer** column can only be null if **anonymous_customer_id** is not null. 

In some cases the desired customer identifier is not yet available. When that happens the **anonymous_customer_id** column is used in its place. It allows the activity stream to store an alternate identifier for an entity — called a local identifier (in contrast to the global identifier in the **customer** column).

For example, say we're tracking customer page views on a web site. Visits are typically anonymous, so trackers like Segment or Google Analytics assign a proprietary id to the site visitor. This allows them to track the same person across sessions, even if we know nothing else about them. 

In this situation, store that anonymous identifier in **anonymous_customer_id.**  By convention we prepend the name of the service providing the identify to the identifier in the **anonymous_customer_id** column. For example: 'segment_abd5d3...' or 'ga4_f9b9c...' It's not strictly necessary, but it can help with ensuring uniqueness and quickly identifying the origin of the anonymous ids.

When **customer** and **anonymous_customer_id** are both available it creates an association that can be used for identity resolution: all previous activities with only **anonymous_customer_id** can now be understood to be from that customer. A common practice is to fill in the **customer** column in older records once that link has been established.

The three metadata columns, **feature_1**, **feature_2**, and **feature_3,** are used to store additional fields per activity.  They can store anything that fits in a string (length 255) and need to be consistent per activity, but can vary across different activities. 

For example, for the 'received_email' activity, **feature_1** could be the sender email, **feature_2** could be the subject, and **feature_3** could be the marketing campaign used. For the 'viewed_page' activity **feature_1** could be the url, and **feature_2** could be the referrer. 

These columns are stored as strings because the types will vary between activities. When querying an activity it can make sense to cast the contents of a feature column to a specific type if desired.

The columns **revenue_impact** and **link** are two additional metadata fields that are commonly used. 

**revenue_impact** is a number that captures money coming in (or out). For example, a 'paid_invoice' activity would likely have revenue impact set to the invoice total. This field is frequently summed in aggregation queries to compute things like total revenue over a time period.

**link** is used to store a hyperlink relevant to the activity. For example, a 'submitted support ticket' activity could have a link to the actual support ticket in Zendesk. This provides one click access to the source record for the data, which helps immensely when exploring or debugging. 

<br/>


**Additional Columns**

The activity schema contains two special columns used to make queries simpler and more performant. 

The column **activity_occurrence** represents the number of times a given entity has done that activity, at the time that activity occurred (starting with 1). **activity_repeated_at** is the timestamp of the next time that same activity occurred for that entity. Both should be NULL if another activity has not yet occurred.

Both **activity_occurrence** and **activity_repeated_at are** computed from the activity stream itself, so it's dependent on an implementation of the activity schema to fill them in. They rely on previous instances of a given activity, so should be computed after the activity is recorded and after a customer has been assigned. 

The **_activity_source** column is to help the implementation of an activity stream — it's metadata about how the activity stream itself is built, and is not used in querying. It records an identifier to the transformation script that created this activity. It's used by activity schema implementations to support incremental updates of the activity stream (identify all activity rows created by the given transformation, find the maximum timestamp, and insert new rows with a newer timestamp). 


<br/>
<br/>

### Performance

The activity stream table is designed for fast queries on common data warehouses like Redshift, BigQuery, and Snowflake. Nearly all modern data warehouses are [column-oriented](https://en.wikipedia.org/wiki/Column-oriented_DBMS) — tables with fewer columns and many rows perform fastest. In addition, the activity stream table typically only needs to be joined with itself when queried, which further increases performance over other modeling approaches.

That said, it's important to pick the correct sort / dist / partition / cluster / index (depending on warehouse technology) to ensure high performance. A detailed discussion is out of scope for this specification, but generally sorting / indexing by (**activity, ts, activity_occurrence**) ****is a good starting point. 


<br/>
<br/>

## Entity Table

The entity table stores an unlimited number of metadata columns. By convention it takes its name directly from the entity. For example, for an activity schema with an entity named 'customer', the table would be called `customers`. For an activity schema about bikes the table would be called `bikes`. 

Conceptually the table contains a primary key column to identify the unique customer and an unlimited amount of optional columns containing the metadata. This is similar to dimension tables in a star schema. When querying the activity schema this table can be joined in when required by using the entity identifier. 

The primary key column is the only required column and by convention is always named **customer** — the same name as the corresponding column in the activity stream. ****It must store the same entity identifier as the activity stream. 

```sql
SELECT * 
FROM bike_stream
LEFT JOIN customers 
	ON bike_stream.customer = bikes.customer
```


<br/>
<br/>

## Additional Metadata

An activity schema treats metadata slightly differently than other modeling approaches. The core difference is that activities are meant to be built independently of each other and with no consideration for the data questions they'll eventually answer. A good analogy is LEGO bricks: they have their own unique shape and are assembled together to create anything. They weren't designed ahead of time to only make a house or a boat or a robot. 

Wide tables (with lots of useful columns) are built only when querying the activity stream, not when defining activities. 

This all means that activities should only store metadata directly related to themselves — i.e. a 'bike_ride_ended' activity could have a 'distance_traveled' feature, but wouldn't have a 'num_trips_taken'. Similarly, a 'submitted_support_ticket' activity wouldn't have a 'last_product_purchased' feature on it. 

These additional features aren't needed because they can be 'borrowed' from other activities when querying the activity stream. The result is most (99%) of activities have three or fewer features, and wide tables can be easily generated at query-time by joining in other activities.

<br/>
<br/>

### Borrowing Features

Borrowing features is really another way of saying that activities can be assembled together to create any kind of wide table needed for analysis. It's common to join multiple activities together in a query to do this. 

Say we wanted to group all 'submitted_support_ticket' activities by the last product purchased.  Because all activities can be joined together over time, it's a fairly straightforward query join in the last completed_order before each submitted support ticket and select its 'product' feature. 

This approach is the recommended way to query more metadata than available in a single activity.

<br/>
<br/>


### Enrichment Tables

Sometimes metadata is only relevant to a particular activity and still doesn't fit in the three feature columns.

To support this there is actually a third type of table in the activity schema, called an enrichment table, but it's not used very often. Borrowing is generally a better strategy, and joining in another table has a performance impact. 

Enrichment tables are for features that 1. don't fit in the available metadata spots in the activity stream and 2. are 'natural' metadata for an existing activity (i.e. don't make sense on any other activity). 

Enrichment tables are not frequently used in practice. The vast majority of activities only need the core metadata columns already present in the activity stream. Enrichment tables also have the performance cost of an additional join.

Enrichment tables serve the same purpose as the entity table, but for specific activities. They allow adding any arbitrary amount of metadata to an activity. Enrichment tables are only needed when a specific activity has too many features on its own. The most common example is to enrich page views: things like utm_params, referrer, ip_address, etc don't fit in the three fields, and there is no obvious other activity to own them. 

An enrichment table is typically named after the activity it enriches, taking the structure `enriched_<activity>.`

An enrichment table has two required columns - **enriched_activity_id** and **enriched_ts,** which are used to join it into the activity stream. From there it can have any number of additional columns of any type. 

<br/>

**Column**|**Description**|**Type**
-----|-----|-----
enriched\_activity\_id|activity\_id of the activity (or activities) that this row will enrich|string
enriched\_ts|Timestamp in UTC of the activity (or activities) that this row will enrich|timestamp
feature columns|(optional) These columns are the additional features used to enrich an activity or activities.|various

The **enriched_activity_id** must be the same id as the corresponding **activity_id** in the activity stream.

Note that since **activity_id** is unique per activity, not globally, the proper way to join is like this:

```sql
LEFT JOIN enriched_pages AS e 
  ON (
    customer_stream.activity = 'viewed_page'  AND
    customer_streams.activity_id = e.enriched_activity_id 
  )
```

As the above shows, **enriched_ts** is not strictly needed to join an enrichment table. It's actually optional and is in place for performance reasons: if a query against the activity stream filters by the **ts** column then it's faster to also filter by the **enriched_ts** column in the join. 

The **enriched_ts** column is usually the same timestamp as the corresponding activity **ts,** but because it's used to filter by time it's not required to be exactly the same value. 

It's also useful to have **enriched_ts** if building an enrichment table incrementally - it's an easy way to see the most up-to-date enriched activity timestamp. 


<br/>
<br/>
<br/>


# Using an Activity Schema

An activity schema only has a single model table — the activity stream.  An activity stream table can be reassembled to generate any table for BI, reporting, and analysis. 

Using an activity schema in practice consists of two things

1. Modeling - transforming raw tables into an activity stream 
2. Querying - retrieving data from the activity stream for BI

Both are a bit different than in more traditional approaches, so it's worth looking at them in more detail

![image](https://user-images.githubusercontent.com/1216989/113029354-54292980-915a-11eb-974d-ac24677e7bda.png)

Modeling here is the step to transform source tables in a data warehouse into the activity stream format. Querying is running SQL queries against the activity stream table to generate tables, materialized views, etc to be used for BI. 

There is a strong separation between modeling and querying. Any changes to how activities are built has no downstream impact on the queries depending on them. This makes it extremely easy to keep up with changes in production systems. Any type of source data change — from a changed column to swapping out to a completely different system with a new set of tables — simply requires updating the activity, while changing **none** of the downstream queries. This makes each activity the actual source of truth for each concept in the warehouse.


<br/>
<br/>

## Modeling

An activity schema is built by running simple SQL queries to transform raw source data to the activity stream format. This process should be familiar — it is no different than the Transform step (T) of an ELT approach to data ingestion and modeling.

In an activity schema there is only a single model layer — the activity stream table, and the primary modeling concept is an activity (rather than a noun like an 'order' or an 'invoice'). 

The process is straightforward

1. choose your activities
2. find relevant raw table(s)
3. write a SQL query to create each activity

### Choose Activities

Not all raw tables are modeled directly. Instead of thinking about what to do with each raw table, it helps to first identify which activities make sense. Generally they'll map to well known business processes or customer touch points, all from the perspective of the entity. It's fairly easy to add new activities or to change them, so it's also a good idea to start with a question, figure out which activities are needed, and add those. Pretty quickly this will converge to a core set.

For example, for our bike sharing app some activities for the bike stream could be

1. ride started
2. ride ended
3. maintenance requested
4. moved to new location

Some activities for the customer could be

1. purchased daily pass
2. started ride
3. purchased yearly subscription
4. submitted maintenance request
5. viewed web page
6. opened ride app
7. viewed bike availability

Once the activities have been identified then it's usually fairly straightforward to find which source table(s) will be needed. The only requirement is that we can identify an entity, a relevant activity, and a timestamp. 


<br/>
<br/>


### SQL Transformations

SQL Transformations are short SQL queries that map from source data to the activity stream format. They are typically fairly small and easy to write. 

For example, this is how **completed_order** is built from Shopify data

```sql
SELECT
     o.id AS activity_id

     , o.processed_at AS ts

     , NULL     AS anonymous_customer_id
     , o.email  AS customer

     , 'completed_order' AS activity
     , d.code   AS feature_1 -- discount code
     , o.name   AS feature_2 -- order name
     , NULL     AS feature_3

     , (o.total_price - o.total_discounts) AS revenue_impact

     , NULL  AS link

FROM shopify.order AS o
LEFT JOIN shopify.order_discount_code d
    ON (d.order_id = o.id)

WHERE
    o.cancelled_at is NULL
    and o.email is not NULL
    and o.email <> ''
```

This SQL is pretty straightforward

1. the **completed_order** activity is defined independently — it doesn't have to join with any other tables. We just need to find the customer's unique identifier (in this case email)
2. activities generally conform to well-known business processes, so the data is frequently close to the desired format already

In practice nearly all transformation scripts are less than 30 lines and one or two joins. 

In addition, there's no reason that transformation scripts and activities have to be 1:1. For example, a 'received_email' activity could be defined from source tables from multiple systems. Or a single transformation can create multiple activities.

<br/>
<br/>

### Building an activity stream

Companies maintaining data models in their warehouse run scheduled tasks to keep all tables up to date. In practice, this is done with a periodically running scheduled task (using a tool like dbt) that carefully manages a graph of table dependencies.

The activity schema approach is effectively the same, only without the layers of dependencies. A common approach is to create a single SQL query per activity desired, and append the results of each query to the activity stream table. 

This approach also means that incremental updates to the activity stream are straightforward (identify all activity rows created by the given transformation, find the maximum timestamp, and insert rows with a newer timestamp).

Building an activity schema implementation requires these steps

- periodically run transformation SQL queries and insert the results into the activity stream
- periodically scan the activity stream and fill in the **activity_occurrence** and **activity_repeated_at** columns
- if **anonymous_customer_id** is used, periodically scan the activity stream and fill in **customer** for the **anonymous_customer_id** that has been identified.


<br/>
<br/>

## Querying

An activity schema differs in some fundamental ways to more traditional approaches

1. data is in a time-series format
2. queries only select from the activity stream table (and optionally join in enrichment tables)
3. any activity can be related (joined) to any other activity using only the entity and timestamp

This means that querying is a bit different but substantially more powerful. 

An activity schema **does not require any foreign key joins.** All joins are self-joins to the activity_stream table, and they only use the entity and timestamp columns. This means there is **always** a way to relate **any data** in an activity schema to anything else. 

Another way of phrasing this is that

1. Any query can substitute different activities by merely changing the activity name(s) where present in the query
2. Any query can be run on any activity schema implementation (say at a different company) by substituting activities if necessary

> This means that someone could build a customer lifetime value analysis, and run it on any number of companies' data with minimal modification.

Or one could compute the conversion rate over time of one activity to another (what percent of signups converted to orders) then quickly substitute the activities to answer a related question (what percent of orders converted to another order). In existing approaches, this usually requires restructuring the query, and in some cases in-depth work to find the right foreign keys to join. 

Lastly, a consistent table structure coupled with easily-modified queries means that it is far more useful to automatically generate SQL than before. An activity schema is best queried by specifying which kinds of activities and relationships matter and allowing a system to generate the actual SQL. See the Known Implementations section for some examples.

To better explain the concepts above we'll show a few hand-built queries. 

<br/>
<br/>


### Basic Queries

Simple queries are largely the same. Let's take a hypothetical bike-sharing company as an example. The monthly number of day passes sold, along with revenue, is pretty straightforward.

```sql
SELECT
    DATE_TRUNC('month', ts) AS month,
    COUNT(1) as total_orders,
    SUM(revenue_impact) as total_revenue
FROM customer_stream AS c
**WHERE c.activity = 'purchased_day_pass'** 

GROUP BY month
ORDER BY month
```

It's fairly obvious that counting total yearly subscriptions instead of day passes simply requires substituting '**subscribed_to_yearly_pass**' for '**purchased_day_pass**'.  

```sql
SELECT
    DATE_TRUNC('month', ts) AS month,
    COUNT(1) as total_orders,
    SUM(revenue_impact) as total_revenue
FROM customer_stream AS c
**WHERE c.activity = 'subscribed_to_yearly_pass'** 
GROUP BY month
ORDER BY month
```

Now let's see how this works when relating multiple activities together. 

<br/>
<br/>

### Multiple Activities

Relating multiple activities together is done by joining the single activity stream table to itself using the customer identifier and timestamps. Since these two things are present on all activities, swapping out different activities will still work. 

Let's say our hypothetical bike share company wants to see how many day passes each customer bought before getting their first yearly subscription. 

The approach is to get all first-time yearly subscriptions (using **activity_occurrence**), then for each one join in all the day pass activities that came before. 

```sql
SELECT
    year_sub.customer,
    COUNT(1) AS "total_purchased_day_pass_before"
FROM customer_stream AS year_sub
INNER JOIN customer_stream AS day_pass
    ON ( 
        day_pass.customer = year_sub.customer AND
        day_pass.ts < year_sub.ts
    )
WHERE ( 
    year_sub.activity = '**subscribed_to_yearly_pass**' AND
    year_sub.activity_occurrence = 1 AND
    day_pass.activity = '**purchased_day_pass**' 
)
GROUP BY year_sub.customer
```

This query returns all customers who have at some point subscribed to a yearly pass, along with the count of the total number of day passes they bought before their first subscription. 

Now what if we wanted to see how many marketing emails customers received before opening their first email? It's the same query. Simply substitute '**marketing_email_received**' for '**purchased_day_pass**' and '**marketing_email_opened**' for '**subscribed_to_yearly_pass**'

<br/>
<br/>

### Conversion

Another common example is computing the conversion rate from one activity to another. Say we want to know how a customer opening an email converts to a yearly pass.

This query will return every conversion from an email opened to a yearly pass, along with timestamps for both and the activity id of the email opened.

A conversion means that the user opened an email, and then some time later subscribed to a yearly pass before opening another email. It finds the first yearly pass in between two opened email activities (making great use of **activity_repeated_at**) ****

```sql
SELECT
    customer,
    activity_id,
    ts as "timestamp",
    MIN(first_in_between_yearly_pass_timestamp) as first_in_between_yearly_pass_timestamp
FROM (
    SELECT
        e.customer
        , e.activity_id
        , e.activity_repeated_at
        , e.ts
        , y.ts AS "first_in_between_yearly_pass_timestamp"
    FROM customer_stream AS e 
    INNER JOIN customer_stream AS y 
        ON ( 
            y.customer = e.customer  AND
            y.ts > e.ts  AND
            y.ts <= NVL(e.activity_repeated_at, CAST('2100-01-01' AS TIMESTAMP)) 
        )
    WHERE (
        e.activity = 'opened_email' AND
        y.activity = 'subscribed_to_yearly_pass'
    )
)
GROUP BY customer, activity_id, ts
```

The code above can be used as a subquery and joined with all email opened activities to find which ones converted vs didn't, and grouped to calculate conversion rates. 

As with all the other examples the two activities were joined together using timestamps and the entity, which of course are available on all activities. So once again, we can easily substitute any other activity names to do any kind of conversion. 

This allows very fast ad-hoc querying in practice. Queries can be written once and slightly modified to ask all kinds of new questions without having to figure out how to join new tables to each other.

<br/>
<br/>

### Activity Occurrence and Repeated At

Note the use of **activity_occurrence** and **activity_repeated_at** in the queries above. Without them we'd have to resort to some very expensive window functions.

They can be used to easily get the first time each customer did an activity (`activity_occurrence = 1`) and the last time (`activity_repeated_at = null`). Since these two expressions each return only one row per customer, they're also a very efficient way to get every unique customer that has done an activity. 

<br/>
<br/>

### Automatic SQL Generation

Though we gave hand-written examples, the single, fixed table approach of the activity schema is designed for automatic query generation. 

At its core, querying an activity schema is really about specifying a set of activities and how they relate. Expressing a query this way, and allowing a tool to generate the actual SQL, is far easier than writing it by hand. Activity stream queries are generally somewhat complex and very repetitive. 

And because the activity schema ensures all activities can relate to each other, **there are no queries that have to be hand-built**. As long as an activity exists, it can be used for querying, analysis, etc with no extra work. 

Implementations of an activity schema (see below) will often provide a UI for the user to select activities and the relationships between them, and automatically generate and run queries. 

<br/>
<br/>

# Known Activity Schema Implementations

[Narrator](https://www.narrator.ai) provides an implementation of the activity schema as a service, along with a full data platform to manage and query it.

<br/>
<br/>

# Appendix: Revision History

**Version**|**Date**|**Notes**
-----|-----|-----
1.1|2021-12-01|Replaced `source` and `source_id` with `anonymous_customer_id`
1.0|2021-04-30|Initial Spec
