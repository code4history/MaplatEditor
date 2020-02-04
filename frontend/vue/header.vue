<template>
    <nav class="navbar navbar-inverse navbar-fixed-top">
        <div class="container">
            <div class="navbar-header">
                <button type="button" class="navbar-toggle collapsed" data-toggle="collapse" data-target="#navbar" aria-expanded="false" aria-controls="navbar">
                    <span class="sr-only">Toggle navigation</span>
                    <span class="icon-bar"></span>
                    <span class="icon-bar"></span>
                    <span class="icon-bar"></span>
                </button>
                <a class="navbar-brand" href="#">Maplat Editor</a>
            </div>
            <div id="navbar" class="navbar-collapse collapse">
                <ul class="nav navbar-nav">
                    <header-option v-bind:current="current" v-bind:target="target0" v-bind:title="$t('navbar.edit_map')"></header-option>
                    <header-option v-bind:current="current" target="applist.html" v-bind:title="$t('navbar.edit_app')"></header-option>
                    <header-option v-bind:current="current" target="settings.html" v-bind:title="$t('navbar.settings')"></header-option>
                </ul>
            </div><!--/.nav-collapse -->
        </div>
    </nav>
</template>

<script>
    module.exports = {
        created() {
            console.log('HOgehohe');
            if (!this.target0) this.target0 = 'maplist.html';
        },
        props:[
            '$t',
            'current',
            'target0'
        ],
        /*components: {
            'header-option': {
                props: [
                    'current',
                    'target',
                    'title'
                ],
                template: '<li v-if="current == target" class="active"><a href="#">{{title}}</a></li><li v-else><a v-bind:href="target">{{title}}</a></li>'
            }
        }*/
    }
</script>

<style>
</style>