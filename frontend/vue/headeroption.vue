<template>
    <li v-if="current == target" class="active"><a href="#">{{title}}<!--{ {$t("navbar.edit_map")} }--></a></li>
    <li v-else><a v-bind:href="target">{{title}}</a></li>
</template>

<script>
    module.exports = {
        props:[
            'current',
            'target',
            'title'
        ]
    }
</script>

<style>
</style>